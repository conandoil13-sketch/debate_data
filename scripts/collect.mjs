import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "collector.config.json");
const DEFAULT_EXAMPLE_PATH = path.join(ROOT, "config", "collector.config.example.json");

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const configPath = getConfigPath();
  const config = await loadConfig(configPath);

  const debates = await listDocuments(config, "debates");
  const users = await listDocuments(config, "users");
  const targetParticipants = resolveParticipantTarget(users, config);

  const aggregatedDebates = [];
  for (const debateDoc of debates) {
    const normalizedDebate = normalizeDebateDoc(debateDoc);
    if (!normalizedDebate || normalizedDebate.id === "sandbox") {
      continue;
    }

    const status = computeStatus(normalizedDebate.startTime, new Date());
    const [votes, comments, sessions, payloads] = await Promise.all([
      listDocuments(config, `debates/${normalizedDebate.id}/votes`),
      listDocuments(config, `debates/${normalizedDebate.id}/comments`),
      listDocuments(config, `debates/${normalizedDebate.id}/sessions`),
      listDocuments(config, `debates/${normalizedDebate.id}/payloads`)
    ]);

    const aggregate = buildDebateAggregate({
      debate: normalizedDebate,
      status,
      targetParticipants,
      votes,
      comments,
      sessions,
      payloads,
      includeParticipantNicknames: config.includeParticipantNicknames
    });

    aggregatedDebates.push(aggregate);
    await sleep(config.requestDelayMs);
  }

  aggregatedDebates.sort((a, b) => b.startTime.localeCompare(a.startTime));

  const output = {
    generatedAt: new Date().toISOString(),
    source: "firestore-rest-aggregate",
    requestDelayMs: config.requestDelayMs,
    keywords: buildGlobalKeywords(aggregatedDebates),
    debates: aggregatedDebates
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const outputPath = path.resolve(ROOT, config.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${aggregatedDebates.length} debates to ${outputPath}\n`);
}

function getConfigPath() {
  const configFlagIndex = process.argv.indexOf("--config");
  if (configFlagIndex !== -1) {
    const explicitPath = process.argv[configFlagIndex + 1];
    if (!explicitPath) {
      throw new Error("--config 뒤에 경로가 필요합니다.");
    }
    return path.resolve(ROOT, explicitPath);
  }
  return DEFAULT_CONFIG_PATH;
}

async function loadConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    validateConfig(parsed);
    return {
      outputPath: "./data/debates.json",
      timezone: "Asia/Seoul",
      requestDelayMs: 250,
      participantTargetStrategy: "student-users",
      includeParticipantNicknames: true,
      ...parsed
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `설정 파일이 없습니다: ${configPath}\n예시 파일: ${DEFAULT_EXAMPLE_PATH}`
      );
    }
    throw error;
  }
}

function validateConfig(config) {
  if (!config?.firebase?.projectId || !config?.firebase?.apiKey) {
    throw new Error("collector config에 firebase.projectId 와 firebase.apiKey가 필요합니다.");
  }
}

async function listDocuments(config, collectionPath) {
  let pageToken = "";
  const documents = [];

  while (true) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents/${collectionPath}`
    );
    url.searchParams.set("key", config.firebase.apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Firestore 요청 실패 (${collectionPath}): ${response.status} ${text}`);
    }

    const payload = await response.json();
    for (const doc of payload.documents ?? []) {
      documents.push(normalizeFirestoreDocument(doc));
    }

    if (!payload.nextPageToken) {
      return documents;
    }

    pageToken = payload.nextPageToken;
    await sleep(config.requestDelayMs);
  }
}

function normalizeFirestoreDocument(doc) {
  const nameParts = doc.name.split("/");
  return {
    id: nameParts[nameParts.length - 1],
    fields: convertValue({ mapValue: { fields: doc.fields ?? {} } })
  };
}

function convertValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map((entry) => convertValue(entry));
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, inner]) => [key, convertValue(inner)])
    );
  }
  return null;
}

function normalizeDebateDoc(doc) {
  const data = doc.fields;
  if (!data.startTime) {
    return null;
  }

  const startTime = new Date(data.startTime);
  return {
    id: doc.id,
    title: data.title ?? "",
    url: data.url ?? "",
    agendaSetter: data.agendaSetter ?? "",
    architect: data.architect ?? "",
    startTime
  };
}

function computeStatus(startTime, now) {
  const reviewStart = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
  const closeTime = new Date(startTime.getTime() + 48 * 60 * 60 * 1000);

  if (now < startTime) return "pending";
  if (now < reviewStart) return "active";
  if (now < closeTime) return "reviewing";
  return "closed";
}

function formatDebatePeriod(startTime, timezone) {
  const endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });

  const startParts = formatter.formatToParts(startTime);
  const endParts = formatter.formatToParts(endTime);
  return `${buildDateLabel(startParts)} 오후 6시 - ${buildDateLabel(endParts)} 오후 6시`;
}

function buildDateLabel(parts) {
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  return `${month}.${day}(${weekday})`;
}

function resolveParticipantTarget(users, config) {
  if (config.participantTargetStrategy !== "student-users") {
    return Number(config.participantTargetStrategy) || 0;
  }

  return users.filter((user) => user.fields.role === "student").length;
}

function buildDebateAggregate({
  debate,
  status,
  targetParticipants,
  votes,
  comments,
  sessions,
  payloads,
  includeParticipantNicknames
}) {
  const voteMap = new Map(votes.map((vote) => [vote.id, vote.fields]));
  const commentMap = new Map(comments.map((comment) => [comment.id, comment.fields]));
  const sessionMap = new Map(sessions.map((session) => [session.id, session.fields]));
  const payloadSet = new Set(payloads.map((payload) => payload.id));

  const participantNames = new Set([
    ...voteMap.keys(),
    ...commentMap.keys(),
    ...sessionMap.keys(),
    ...payloadSet.values()
  ]);

  const participantRecords = [...participantNames]
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((nickname) => {
      const vote = voteMap.get(nickname);
      const comment = commentMap.get(nickname);
      const session = sessionMap.get(nickname);
      const joined = payloadSet.has(nickname) || Boolean(session) || Boolean(vote) || Boolean(comment);
      return {
        nickname: includeParticipantNicknames ? nickname : "",
        side: mapSide(vote?.side),
        joined,
        insight: Boolean(comment),
        insightText: normalizeInsightText(comment?.analysis),
        persuaded: comment?.persuaded === true,
        bestInsight: comment?.isBestInsight === true,
        durationMin: Math.round(Number(session?.totalDuration ?? 0) / 60),
        lastHeartbeat: normalizeTimestamp(session?.lastHeartbeat)
      };
    });

  const proCount = votes.filter((vote) => vote.fields.side === "pro").length;
  const conCount = votes.filter((vote) => vote.fields.side === "con").length;
  const durations = sessions
    .map((session) => Number(session.fields.totalDuration ?? 0))
    .filter((value) => value > 0);
  const avgDurationMin = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 60)
    : 0;
  const proDurations = participantRecords
    .filter((participant) => participant.side === "찬성" && participant.durationMin > 0)
    .map((participant) => participant.durationMin);
  const conDurations = participantRecords
    .filter((participant) => participant.side === "반대" && participant.durationMin > 0)
    .map((participant) => participant.durationMin);
  const proAvgDurationMin = proDurations.length
    ? Math.round(proDurations.reduce((sum, value) => sum + value, 0) / proDurations.length)
    : 0;
  const conAvgDurationMin = conDurations.length
    ? Math.round(conDurations.reduce((sum, value) => sum + value, 0) / conDurations.length)
    : 0;
  const insightAuthors = comments.length;
  const persuasiveCount = comments.filter(
    (comment) => comment.fields.role === "participant" && comment.fields.persuaded === true
  ).length;
  const bestInsightCount = comments.filter((comment) => comment.fields.isBestInsight === true).length;
  const joinedParticipants = participantRecords.filter((participant) => participant.joined).length;
  const keywords = extractKeywords(
    comments.map((comment) => comment.fields.analysis).filter(Boolean)
  );

  return {
    id: debate.id,
    title: debate.title,
    url: debate.url,
    status,
    period: formatDebatePeriod(debate.startTime, "Asia/Seoul"),
    startTime: debate.startTime.toISOString(),
    agendaSetter: debate.agendaSetter,
    architect: debate.architect,
    participantsTarget: targetParticipants,
    participantsJoined: joinedParticipants,
    proCount,
    conCount,
    avgDurationMin,
    proAvgDurationMin,
    conAvgDurationMin,
    insightAuthors,
    persuasiveCount,
    bestInsightCount,
    keywords,
    participants: participantRecords
  };
}

function extractKeywords(texts) {
  const counter = new Map();
  texts
    .join(" ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token))
    .forEach((token) => {
      counter.set(token, (counter.get(token) ?? 0) + 1);
    });

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));
}

function normalizeInsightText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  return value;
}

function buildGlobalKeywords(aggregatedDebates) {
  const counter = new Map();
  aggregatedDebates.forEach((debate) => {
    (debate.keywords ?? []).forEach((entry) => {
      counter.set(entry.word, (counter.get(entry.word) ?? 0) + entry.count);
    });
  });

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word, count]) => ({ word, count }));
}

const STOPWORDS = new Set([
  "토론",
  "토론이",
  "토론의",
  "토론에",
  "토론을",
  "토론에서",
  "의견",
  "의견을",
  "의견이",
  "의견에",
  "주장",
  "주장을",
  "주장과",
  "반박",
  "반박을",
  "입장",
  "입장을",
  "그리고",
  "그러나",
  "하지만",
  "또한",
  "그래서",
  "때문에",
  "대한",
  "대해",
  "대해서",
  "이번",
  "정말",
  "그냥",
  "조금",
  "이런",
  "그런",
  "이렇게",
  "저렇게",
  "있는",
  "있다",
  "있어",
  "있었다",
  "있다는",
  "없다",
  "된다",
  "되었다",
  "하는",
  "한다",
  "했다",
  "같다",
  "것",
  "것이",
  "것을",
  "것은",
  "것도",
  "것과",
  "것처럼",
  "것으로",
  "것이라고",
  "것이다",
  "것이며",
  "것인데",
  "것같다",
  "다만",
  "즉",
  "이미",
  "계속",
  "서로",
  "매우",
  "너무",
  "훨씬",
  "더욱",
  "바로",
  "약간",
  "대부분",
  "부분",
  "상황",
  "형태",
  "방식",
  "경우",
  "느낌",
  "생각",
  "생각이",
  "생각을",
  "생각한다",
  "생각했다",
  "보인다",
  "보였다",
  "느껴졌다",
  "느꼈다",
  "말했다",
  "말하는",
  "하였다",
  "했다는",
  "댓글을",
  "글자수",
  "좋아요",
  "글을",
  "같은",
  "따라",
  "이전",
  "글자",
  "기존",
  "점은",
  "되는",
  "많은",
  "있게",
  "보다",
  "점이",
  "해당",
  "이는",
  "않았다",
  "있어서",
  "사람들이",
  "사람들의",
  "사람의",
  "쉽게",
  "느낌이",
  "어떤",
  "비해",
  "있었던",
  "점을",
  "자신의",
  "다른",
  "가장",
  "많이",
  "특히",
  "오히려",
  "아니라",
  "기능이",
  "ui는",
  "그리고",
  "에서",
  "으로",
  "에게",
  "에서의",
  "이며",
  "이고",
  "이라",
  "처럼",
  "처럼",
  "하다",
  "하며",
  "하면",
  "하면",
  "이다",
  "였다",
  "the",
  "and",
  "that",
  "with",
  "this"
]);

function mapSide(side) {
  if (side === "pro") return "찬성";
  if (side === "con") return "반대";
  return "참여";
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
