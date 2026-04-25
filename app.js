let debates = [];
let selectedParticipant = null;
let globalKeywords = [];
let visibleDebatesState = [];
let chartTooltip = null;
let advancedFilters = {
  participants: new Set(),
  dates: new Set(),
  initialized: false
};
let profilesSort = {
  key: "sincerityScore",
  direction: "desc"
};
let profilesPagination = {
  page: 1,
  perPage: 6
};
let exclude1004FromDuration = false;

const statusLabelMap = {
  pending: "예정",
  active: "진행중",
  reviewing: "집계중",
  closed: "종료"
};

const statusColorMap = {
  pending: { solid: "#8b5cf6", soft: "#efe7ff" },
  active: { solid: "#1f62ff", soft: "#d9e5ff" },
  reviewing: { solid: "#f2b134", soft: "#fff0cb" },
  closed: { solid: "#31404f", soft: "#dfe7ef" }
};

function percent(value) {
  return `${Math.round(value)}%`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeMetrics(debate) {
  const totalVotes = debate.proCount + debate.conCount;
  const participationRate = debate.participantsTarget
    ? (debate.participantsJoined / debate.participantsTarget) * 100
    : 0;
  const insightRate = debate.participantsJoined
    ? (debate.insightAuthors / debate.participantsJoined) * 100
    : 0;
  const persuasionRate = debate.insightAuthors
    ? (debate.persuasiveCount / debate.insightAuthors) * 100
    : 0;
  const balanceScore = totalVotes
    ? 100 - Math.abs((debate.proCount / totalVotes) * 100 - 50) * 2
    : 0;
  const engagementScore = Math.round(
    participationRate * 0.45 +
      Math.min(debate.avgDurationMin * 2.2, 100) * 0.35 +
      insightRate * 0.2
  );

  return {
    totalVotes,
    participationRate,
    insightRate,
    persuasionRate,
    balanceScore,
    engagementScore
  };
}

function applyDurationFilterToDebate(debate) {
  if (!exclude1004FromDuration) {
    return debate;
  }

  const filteredParticipants = (debate.participants ?? []).filter(
    (participant) => String(participant.nickname ?? "").trim() !== "1004" && participant.joined
  );
  const proParticipants = filteredParticipants.filter((participant) => participant.side === "찬성");
  const conParticipants = filteredParticipants.filter((participant) => participant.side === "반대");

  return {
    ...debate,
    avgDurationMin: filteredParticipants.length
      ? Math.round(average(filteredParticipants.map((participant) => participant.durationMin ?? 0)))
      : 0,
    proAvgDurationMin: proParticipants.length
      ? Math.round(average(proParticipants.map((participant) => participant.durationMin ?? 0)))
      : 0,
    conAvgDurationMin: conParticipants.length
      ? Math.round(average(conParticipants.map((participant) => participant.durationMin ?? 0)))
      : 0
  };
}

function updateDurationFilterStatus() {
  const status = document.getElementById("duration-filter-status");
  const button = document.getElementById("duration-filter-toggle");
  const label = document.getElementById("duration-filter-toggle-label");
  if (!status || !button) {
    return;
  }

  status.textContent = exclude1004FromDuration
    ? "시간 데이터: 1004 제외 기준"
    : "시간 데이터: 전체 참여자 기준";
  button.classList.toggle("is-active", exclude1004FromDuration);
  button.setAttribute("aria-pressed", exclude1004FromDuration ? "true" : "false");
  if (label) {
    label.textContent = exclude1004FromDuration ? "1004 제외 ON" : "1004 제외 OFF";
  }
}

function renderOverview() {
  updateDurationFilterStatus();

  if (!debates.length) {
    document.getElementById("data-status").textContent =
      "아직 표시할 집계 데이터가 없습니다. data/debates.json을 채워주세요.";
    document.getElementById("debate-list").innerHTML = "";
    return;
  }

  const withMetrics = debates.map((debate) => {
    const adjustedDebate = applyDurationFilterToDebate(debate);
    return {
      ...adjustedDebate,
      metrics: computeMetrics(adjustedDebate)
    };
  });
  const visibleDebates = withMetrics.filter((debate) => debate.status !== "pending");

  const countByStatus = visibleDebates.reduce(
    (acc, debate) => {
      acc[debate.status] += 1;
      return acc;
    },
    { active: 0, reviewing: 0, closed: 0 }
  );

  document.getElementById("total-debates").textContent = String(visibleDebates.length);
  document.getElementById("avg-participation-rate").textContent = percent(
    average(visibleDebates.map((item) => item.metrics.participationRate))
  );
  document.getElementById("avg-persuasion-rate").textContent = percent(
    average(visibleDebates.map((item) => item.metrics.persuasionRate))
  );
  document.getElementById("active-count").textContent = String(countByStatus.active);
  document.getElementById("reviewing-count").textContent = String(countByStatus.reviewing);
  document.getElementById("closed-count").textContent = String(countByStatus.closed);
  document.getElementById("avg-duration").textContent = `${Math.round(
    average(visibleDebates.map((item) => item.avgDurationMin))
  )}분`;
  document.getElementById("avg-insight-rate").textContent = percent(
    average(visibleDebates.map((item) => item.metrics.insightRate))
  );
  document.getElementById("avg-balance-score").textContent = `${Math.round(
    average(visibleDebates.map((item) => item.metrics.balanceScore))
  )}점`;
  document.getElementById("avg-engagement-score").textContent = `${Math.round(
    average(visibleDebates.map((item) => item.metrics.engagementScore))
  )}점`;
  document.getElementById("data-status").textContent =
    "현재 화면은 data/debates.json의 집계 데이터로 렌더링되고 있습니다.";

  renderStatusBars(countByStatus, visibleDebates.length);
  renderKeywordCloud();
  renderTrendCharts(visibleDebates);
  renderDebates(visibleDebates);
  visibleDebatesState = visibleDebates;
  renderAdvancedAnalysis(visibleDebates);
  renderParticipantProfiles(visibleDebates);
  renderLinks(withMetrics);
  renderRankings(visibleDebates);
}

function renderKeywordCloud() {
  const cloud = document.getElementById("keyword-cloud");
  if (!cloud) {
    return;
  }

  cloud.innerHTML = "";
  if (!globalKeywords.length) {
    cloud.textContent = "아직 표시할 키워드가 없습니다.";
    return;
  }

  const maxCount = Math.max(...globalKeywords.map((item) => item.count), 1);
  globalKeywords.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "keyword-chip";
    const size = 0.9 + (item.count / maxCount) * 1.2;
    chip.style.fontSize = `${size}rem`;
    chip.style.opacity = `${0.55 + (item.count / maxCount) * 0.45}`;
    chip.textContent = item.word;
    cloud.appendChild(chip);
  });
}

function renderStatusBars(countByStatus, total) {
  const container = document.getElementById("status-bars");
  container.innerHTML = "";

  Object.entries(countByStatus).forEach(([status, count]) => {
    const row = document.createElement("div");
    row.className = "status-row";
    const ratio = total ? (count / total) * 100 : 0;
    const palette = statusColorMap[status];

    row.innerHTML = `
      <div class="status-row-head">
        <span>${statusLabelMap[status]}</span>
        <strong>${count}개 · ${percent(ratio)}</strong>
      </div>
      <div class="status-track">
        <div class="status-fill" style="width:${ratio}%; background:${palette.solid};"></div>
      </div>
    `;

    container.appendChild(row);
  });
}

function renderDebates(withMetrics) {
  const list = document.getElementById("debate-list");
  const template = document.getElementById("debate-card-template");

  list.innerHTML = "";

  withMetrics.forEach((debate) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const palette = statusColorMap[debate.status];
    const proRatio = debate.metrics.totalVotes
      ? (debate.proCount / debate.metrics.totalVotes) * 100
      : 0;
    const conRatio = 100 - proRatio;

    node.querySelector(".status-badge").textContent = statusLabelMap[debate.status];
    node.querySelector(".status-badge").style.background = palette.soft;
    node.querySelector(".status-badge").style.color = palette.solid;
    node.querySelector(".debate-title").textContent = debate.title;
    node.querySelector(".debate-meta").textContent =
      `${debate.period} · 아젠다 세터 ${debate.agendaSetter} · 아키텍트 ${debate.architect}`;
    node.querySelector(".engagement-score").textContent = `${debate.metrics.engagementScore}`;
    node.querySelector(".participation-rate").textContent = percent(debate.metrics.participationRate);
    node.querySelector(".insight-rate").textContent = percent(debate.metrics.insightRate);
    node.querySelector(".persuasion-rate").textContent = percent(debate.metrics.persuasionRate);
    node.querySelector(".duration-value").textContent = `${debate.avgDurationMin}분`;
    node.querySelector(".vote-summary").textContent =
      `찬성 ${debate.proCount} · 반대 ${debate.conCount}`;
    node.querySelector(".vote-bar-pro").style.width = `${proRatio}%`;
    node.querySelector(".vote-bar-con").style.width = `${conRatio}%`;

    const bulletMetrics = [
      `참여 인원 ${debate.participantsJoined}/${debate.participantsTarget}명`,
      `베스트 인사이트 ${debate.bestInsightCount}개`,
      `찬반 균형도 ${Math.round(debate.metrics.balanceScore)}점`,
      `설득된 참여자 ${debate.persuasiveCount}명`,
      `찬성측 평균 체류 ${debate.proAvgDurationMin ?? 0}분`,
      `반대측 평균 체류 ${debate.conAvgDurationMin ?? 0}분`
    ];

    const bulletsEl = node.querySelector(".bullet-metrics");
    bulletMetrics.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      bulletsEl.appendChild(li);
    });

    const chips = node.querySelector(".participant-chips");
    debate.participants.forEach((participant) => {
      const chip = document.createElement("div");
      chip.className = "participant-chip";
      chip.dataset.nickname = participant.nickname;
      const sideClass =
        participant.side === "찬성"
          ? "chip-tag-pro"
          : participant.side === "반대"
          ? "chip-tag-con"
          : "chip-tag-joined";
      chip.innerHTML = `
        <strong>${participant.nickname}</strong>
        <small></small>
        <div class="chip-tags">
          ${participant.joined ? '<span class="chip-tag chip-tag-joined">토론 참여</span>' : ""}
          ${participant.side ? `<span class="chip-tag ${sideClass}">${participant.side}</span>` : ""}
          ${participant.insight ? '<span class="chip-tag chip-tag-insight">인사이트 작성</span>' : ""}
          ${participant.persuaded ? '<span class="chip-tag chip-tag-persuaded">설득됨</span>' : ""}
          ${participant.bestInsight ? '<span class="chip-tag chip-tag-best">베스트 인사이트</span>' : ""}
          ${participant.durationMin > 0 ? `<span class="chip-tag chip-tag-duration">체류 ${participant.durationMin}분</span>` : ""}
        </div>
      `;
      chip.addEventListener("click", () => openParticipantModal(participant.nickname));
      chips.appendChild(chip);
    });

    list.appendChild(node);
  });
}

function renderLinks(withMetrics) {
  const list = document.getElementById("links-list");
  const status = document.getElementById("links-status");
  const summary = document.getElementById("links-summary");
  if (!list || !status || !summary) {
    return;
  }

  const linkItems = [...withMetrics].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const submittedCount = linkItems.filter((debate) => Boolean(debate.url)).length;
  const pendingCount = linkItems.filter((debate) => debate.status === "pending").length;
  summary.textContent = `${submittedCount}개 URL · 예정 ${pendingCount}개`;
  status.textContent = linkItems.length
    ? "예정 토론도 함께 보여주며, URL이 아직 없으면 미제출 상태로 표시합니다."
    : "아직 표시할 제출 정보가 없습니다.";
  list.innerHTML = "";

  linkItems.forEach((debate, index) => {
    const palette = statusColorMap[debate.status];
    const card = document.createElement("article");
    card.className = "link-card";
    card.innerHTML = `
      <span class="link-index">${index + 1}</span>
      <div class="link-copy">
        <span class="status-badge" style="background:${palette.soft}; color:${palette.solid};">${statusLabelMap[debate.status]}</span>
        <h3>${debate.title || "아직 제목이 입력되지 않았습니다."}</h3>
        <div class="link-meta">${debate.period} · 아젠다 세터 ${debate.agendaSetter} · 아키텍트 ${debate.architect}</div>
        ${
          debate.url
            ? `<a class="link-url" href="${debate.url}" target="_blank" rel="noreferrer">${debate.url}</a>`
            : `<div class="link-missing">아직 제출 URL이 없습니다.</div>`
        }
      </div>
      <div class="link-actions">
        ${
          debate.url
            ? `<a class="link-open" href="${debate.url}" target="_blank" rel="noreferrer">열기</a>`
            : `<span class="link-missing">미제출</span>`
        }
      </div>
    `;
    list.appendChild(card);
  });
}

function renderAdvancedAnalysis(withMetrics) {
  const participantContainer = document.getElementById("advanced-participant-chips");
  const dateContainer = document.getElementById("advanced-date-chips");
  const summaryPill = document.getElementById("advanced-summary-pill");
  if (!participantContainer || !dateContainer || !summaryPill) {
    return;
  }

  const records = buildAdvancedRecords(withMetrics);
  const participantNames = [...new Set(records.map((item) => item.nickname))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const dateOptions = [...new Map(records.map((item) => [item.dateKey, item.dateLabel])).entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.key.localeCompare(b.key));

  syncAdvancedFilters(participantNames, dateOptions.map((item) => item.key));
  bindAdvancedFilterActions(participantNames, dateOptions.map((item) => item.key));

  participantContainer.innerHTML = "";
  participantNames.forEach((nickname) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `toggle-chip${advancedFilters.participants.has(nickname) ? " is-active" : ""}`;
    button.textContent = nickname;
    button.addEventListener("click", () => {
      toggleSetValue(advancedFilters.participants, nickname);
      renderAdvancedAnalysis(visibleDebatesState);
    });
    participantContainer.appendChild(button);
  });

  dateContainer.innerHTML = "";
  dateOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `toggle-chip${advancedFilters.dates.has(option.key) ? " is-active" : ""}`;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      toggleSetValue(advancedFilters.dates, option.key);
      renderAdvancedAnalysis(visibleDebatesState);
    });
    dateContainer.appendChild(button);
  });

  const filtered = records.filter(
    (item) =>
      advancedFilters.participants.has(item.nickname) && advancedFilters.dates.has(item.dateKey)
  );

  summaryPill.textContent = `${advancedFilters.participants.size}명 · ${advancedFilters.dates.size}일 선택`;
  renderAdvancedSummaries(filtered);
  renderAdvancedDurationChart(filtered, dateOptions);
  renderAdvancedParticipantCompare(filtered);
  renderAdvancedWeekday(filtered);
  renderAdvancedTopics(filtered);
}

function buildAdvancedRecords(withMetrics) {
  return withMetrics.flatMap((debate) =>
    (debate.participants ?? [])
      .filter((participant) => participant.joined)
      .map((participant) => ({
        nickname: participant.nickname,
        title: debate.title,
        period: debate.period,
        dateKey: debate.startTime.slice(0, 10),
        dateLabel: shortLabel(debate.period),
        weekdayLabel: buildWeekdayLabel(debate.startTime),
        durationMin: participant.durationMin ?? 0,
        avgDurationMin: debate.avgDurationMin ?? 0,
        deltaDuration: (participant.durationMin ?? 0) - (debate.avgDurationMin ?? 0),
        insight: participant.insight,
        persuaded: participant.persuaded,
        bestInsight: participant.bestInsight,
        side: participant.side
      }))
  );
}

function syncAdvancedFilters(participantNames, dateKeys) {
  if (!advancedFilters.initialized) {
    advancedFilters.participants = new Set(participantNames);
    advancedFilters.dates = new Set(dateKeys);
    advancedFilters.initialized = true;
    return;
  }

  advancedFilters.participants = new Set(
    [...advancedFilters.participants].filter((item) => participantNames.includes(item))
  );
  advancedFilters.dates = new Set([...advancedFilters.dates].filter((item) => dateKeys.includes(item)));
}

function bindAdvancedFilterActions(participantNames, dateKeys) {
  const allButton = document.getElementById("advanced-participants-all");
  const noneButton = document.getElementById("advanced-participants-none");
  const datesAllButton = document.getElementById("advanced-dates-all");
  const datesNoneButton = document.getElementById("advanced-dates-none");
  if (allButton) {
    allButton.onclick = () => {
      advancedFilters.participants = new Set(participantNames);
      renderAdvancedAnalysis(visibleDebatesState);
    };
  }
  if (noneButton) {
    noneButton.onclick = () => {
      advancedFilters.participants = new Set();
      renderAdvancedAnalysis(visibleDebatesState);
    };
  }
  if (datesAllButton) {
    datesAllButton.onclick = () => {
      advancedFilters.dates = new Set(dateKeys);
      renderAdvancedAnalysis(visibleDebatesState);
    };
  }
  if (datesNoneButton) {
    datesNoneButton.onclick = () => {
      advancedFilters.dates = new Set();
      renderAdvancedAnalysis(visibleDebatesState);
    };
  }
}

function toggleSetValue(targetSet, value) {
  if (targetSet.has(value)) {
    targetSet.delete(value);
    return;
  }
  targetSet.add(value);
}

function renderAdvancedSummaries(filtered) {
  document.getElementById("advanced-record-count").textContent = `${filtered.length}건`;
  document.getElementById("advanced-avg-duration").textContent = `${Math.round(
    average(filtered.map((item) => item.durationMin))
  )}분`;
  document.getElementById("advanced-above-average").textContent = `${
    filtered.filter((item) => item.durationMin > item.avgDurationMin).length
  }건`;
  document.getElementById("advanced-insight-count").textContent = `${
    filtered.filter((item) => item.insight).length
  }건`;
}

function renderAdvancedDurationChart(filtered, dateOptions) {
  const summary = document.getElementById("advanced-duration-summary");
  const legend = document.getElementById("advanced-duration-legend");
  const selectedDateKeys = dateOptions
    .filter((item) => advancedFilters.dates.has(item.key))
    .map((item) => item.key);
  const selectedDateLabels = dateOptions
    .filter((item) => advancedFilters.dates.has(item.key))
    .map((item) => item.label);
  const selectedParticipants = [...advancedFilters.participants];

  const palette = ["#1f62ff", "#e06d4f", "#5eb59a", "#31404f", "#f2b134", "#8b5cf6", "#2f8d72"];
  const participantAverages = selectedParticipants.map((nickname) => {
    const rows = filtered.filter((item) => item.nickname === nickname);
    return {
      nickname,
      avgDuration: rows.length ? Math.round(average(rows.map((item) => item.durationMin))) : 0
    };
  });
  const focusParticipants = participantAverages
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 5)
    .map((item) => item.nickname);
  const seriesList = focusParticipants.map((nickname, index) => ({
    label: nickname,
    color: palette[index % palette.length],
    values: selectedDateKeys.map((dateKey) => {
      const rows = filtered.filter((item) => item.nickname === nickname && item.dateKey === dateKey);
      return rows.length ? Math.round(average(rows.map((item) => item.durationMin))) : 0;
    })
  }));

  summary.textContent = filtered.length
    ? `상위 ${seriesList.length}명 비교 · 선택 기록 평균 ${Math.round(
        average(filtered.map((item) => item.durationMin))
      )}분`
    : "기록 없음";
  if (legend) {
    legend.innerHTML = seriesList
      .map(
        (series) =>
          `<span><i class="legend-dot" style="background:${series.color}"></i>${series.label}</span>`
      )
      .join("");
  }

  drawMultiLineChart(
    document.getElementById("advanced-duration-chart"),
    selectedDateLabels,
    seriesList.length ? seriesList : [{ color: "#d0c8bd", values: selectedDateLabels.map(() => 0) }],
    Math.max(...filtered.map((item) => item.durationMin), 10),
    "분"
  );
}

function renderAdvancedParticipantCompare(filtered) {
  const container = document.getElementById("advanced-participant-compare");
  const summary = document.getElementById("advanced-participant-compare-summary");
  if (!container || !summary) {
    return;
  }

  const grouped = new Map();
  filtered.forEach((item) => {
    const current = grouped.get(item.nickname) ?? {
      nickname: item.nickname,
      rows: []
    };
    current.rows.push(item);
    grouped.set(item.nickname, current);
  });

  const items = [...grouped.values()]
    .map((group) => {
      const avgDuration = Math.round(average(group.rows.map((item) => item.durationMin)));
      const insightCount = group.rows.filter((item) => item.insight).length;
      const aboveAverageCount = group.rows.filter((item) => item.durationMin > item.avgDurationMin).length;
      return {
        nickname: group.nickname,
        avgDuration,
        insightCount,
        aboveAverageCount,
        count: group.rows.length
      };
    })
    .sort((a, b) => b.avgDuration - a.avgDuration);

  const maxDuration = Math.max(...items.map((item) => item.avgDuration), 1);
  summary.textContent = items.length ? `${items.length}명 비교` : "기록 없음";
  container.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="advanced-compare-row">
              <div class="advanced-compare-head">
                <strong class="advanced-compare-name">${item.nickname}</strong>
                <strong>${item.avgDuration}분</strong>
              </div>
              <div class="advanced-compare-bar">
                <div class="advanced-compare-fill" style="width:${Math.max(
                  8,
                  Math.round((item.avgDuration / maxDuration) * 100)
                )}%"></div>
              </div>
              <div class="advanced-compare-meta">기록 ${item.count}건 · 인사이트 ${item.insightCount}건 · 평균보다 오래 참여 ${item.aboveAverageCount}건</div>
            </article>
          `
        )
        .join("")
    : `<div class="advanced-table-row"><div class="advanced-table-meta">선택 조건에 맞는 참여자 비교 데이터가 없습니다.</div></div>`;
}

function renderAdvancedWeekday(filtered) {
  const list = document.getElementById("advanced-weekday-list");
  const summary = document.getElementById("advanced-weekday-summary");
  if (!list || !summary) {
    return;
  }

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const rows = weekdays.map((weekday) => {
    const matches = filtered.filter((item) => item.weekdayLabel === weekday);
    return {
      weekday,
      avgDuration: Math.round(average(matches.map((item) => item.durationMin))),
      count: matches.length,
      insightRate: matches.length
        ? Math.round((matches.filter((item) => item.insight).length / matches.length) * 100)
        : 0
    };
  });

  const best = rows.reduce((winner, current) => (current.avgDuration > winner.avgDuration ? current : winner), {
    weekday: "-",
    avgDuration: 0
  });
  summary.textContent = filtered.length ? `${best.weekday}요일 평균 ${best.avgDuration}분` : "기록 없음";

  list.innerHTML = "";
  rows.forEach((item) => {
    const card = document.createElement("div");
    card.className = "weekday-stat-item";
    card.innerHTML = `
      <strong>${item.weekday}요일</strong>
      <span>평균 체류 ${item.avgDuration}분</span>
      <span>기록 수 ${item.count}건</span>
      <span>인사이트 작성률 ${item.insightRate}%</span>
    `;
    list.appendChild(card);
  });
}

function renderAdvancedTopics(filtered) {
  const container = document.getElementById("advanced-topic-table");
  const summary = document.getElementById("advanced-topic-summary");
  if (!container || !summary) {
    return;
  }

  const grouped = new Map();
  filtered.forEach((item) => {
    const key = `${item.dateKey}::${item.title}`;
    const current = grouped.get(key) ?? {
      title: item.title,
      dateLabel: item.dateLabel,
      rows: []
    };
    current.rows.push(item);
    grouped.set(key, current);
  });

  const topics = [...grouped.values()]
    .map((group) => ({
      title: group.title,
      dateLabel: group.dateLabel,
      avgDuration: Math.round(average(group.rows.map((item) => item.durationMin))),
      avgBaseline: Math.round(average(group.rows.map((item) => item.avgDurationMin))),
      delta: Math.round(average(group.rows.map((item) => item.deltaDuration))),
      count: group.rows.length
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration);

  summary.textContent = topics.length ? `${topics.length}개 주제 비교` : "기록 없음";
  container.innerHTML = topics.length
    ? topics
        .map(
          (item) => `
            <article class="advanced-table-row">
              <div class="advanced-table-title">
                <strong>${item.title}</strong>
                <span>${item.avgDuration}분</span>
              </div>
              <div class="advanced-table-meta">${item.dateLabel} · 선택 기록 ${item.count}건</div>
              <div class="advanced-table-submeta">토론 평균 ${item.avgBaseline}분 · 평균 대비 ${item.delta > 0 ? "+" : ""}${item.delta}분</div>
            </article>
          `
        )
        .join("")
    : `<div class="advanced-table-row"><div class="advanced-table-meta">선택 조건에 맞는 주제 데이터가 없습니다.</div></div>`;
}

function buildWeekdayLabel(isoString) {
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(isoString).getDay()];
}

function renderTrendCharts(withMetrics) {
  const chronological = [...withMetrics].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const participationTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: debate.metrics.participationRate
  }));
  const durationTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: debate.avgDurationMin
  }));
  const insightTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: debate.metrics.insightRate
  }));
  const persuasionTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: debate.metrics.persuasionRate
  }));
  const insightLengthTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: getAverageInsightLengthForDebate(debate)
  }));
  const engagementTrend = chronological.map((debate) => ({
    label: shortLabel(debate.period),
    value: debate.metrics.engagementScore
  }));
  const volumeLabels = chronological.map((debate) => shortLabel(debate.period));
  const targetTrend = chronological.map((debate) => debate.participantsTarget);
  const joinedTrend = chronological.map((debate) => debate.participantsJoined);
  const insightCountTrend = chronological.map((debate) => debate.insightAuthors);
  const durationCompareTrendRaw = chronological.map((debate) => debate.avgDurationMin);
  const balanceCompareTrendRaw = chronological.map((debate) => Math.round(debate.metrics.balanceScore));
  const persuadedCountTrendRaw = chronological.map((debate) => debate.persuasiveCount);
  const durationCompareTrend = normalizeSeries(durationCompareTrendRaw);
  const balanceCompareTrend = normalizeSeries(balanceCompareTrendRaw);
  const persuadedCountTrend = normalizeSeries(persuadedCountTrendRaw);
  const weekdayStats = buildWeekdayStats(chronological);
  const weeklyStats = buildWeeklyStats(chronological);

  document.getElementById("trend-participation-summary").textContent =
    participationTrend.length >= 2
      ? `${Math.round(participationTrend[0].value)}% -> ${Math.round(participationTrend.at(-1).value)}%`
      : `${Math.round(participationTrend[0]?.value ?? 0)}%`;
  document.getElementById("trend-duration-summary").textContent =
    durationTrend.length >= 2
      ? `${Math.round(durationTrend[0].value)}분 -> ${Math.round(durationTrend.at(-1).value)}분`
      : `${Math.round(durationTrend[0]?.value ?? 0)}분`;
  document.getElementById("trend-insight-summary").textContent =
    insightTrend.length >= 2
      ? `${Math.round(insightTrend[0].value)}% -> ${Math.round(insightTrend.at(-1).value)}%`
      : `${Math.round(insightTrend[0]?.value ?? 0)}%`;
  document.getElementById("trend-persuasion-summary").textContent =
    persuasionTrend.length >= 2
      ? `${Math.round(persuasionTrend[0].value)}% -> ${Math.round(persuasionTrend.at(-1).value)}%`
      : `${Math.round(persuasionTrend[0]?.value ?? 0)}%`;
  document.getElementById("trend-insight-length-summary").textContent =
    insightLengthTrend.length >= 2
      ? `${Math.round(insightLengthTrend[0].value)}자 -> ${Math.round(insightLengthTrend.at(-1).value)}자`
      : `${Math.round(insightLengthTrend[0]?.value ?? 0)}자`;
  document.getElementById("trend-engagement-summary").textContent =
    engagementTrend.length >= 2
      ? `${Math.round(engagementTrend[0].value)}점 -> ${Math.round(engagementTrend.at(-1).value)}점`
      : `${Math.round(engagementTrend[0]?.value ?? 0)}점`;
  document.getElementById("trend-volume-summary").textContent =
    joinedTrend.length > 0
      ? `최근 ${joinedTrend.at(-1)}명 참여 · ${insightCountTrend.at(-1)}명 작성`
      : "기록 없음";
  document.getElementById("trend-intensity-summary").textContent =
    durationCompareTrendRaw.length > 0
      ? `최근 ${durationCompareTrendRaw.at(-1)}분 · 팽팽함 ${balanceCompareTrendRaw.at(-1)}점`
      : "기록 없음";
  document.getElementById("trend-weekday-summary").textContent =
    weekdayStats.length > 0
      ? `가장 높은 참여율 ${weekdayStats.reduce((best, current) => current.participationRate > best.participationRate ? current : best).label}`
      : "기록 없음";
  document.getElementById("trend-weekly-summary").textContent =
    weeklyStats.length > 0
      ? `가장 긴 평균 체류 ${weeklyStats.reduce((best, current) => current.avgDuration > best.avgDuration ? current : best).label}`
      : "기록 없음";

  drawLineChart(
    document.getElementById("participation-trend-chart"),
    participationTrend,
    "#e06d4f",
    100,
    "%",
    "참여율"
  );
  drawLineChart(
    document.getElementById("duration-trend-chart"),
    durationTrend,
    "#31404f",
    Math.max(...durationTrend.map((item) => item.value), 10),
    "분",
    "평균 체류시간"
  );
  drawLineChart(
    document.getElementById("insight-trend-chart"),
    insightTrend,
    "#5eb59a",
    100,
    "%",
    "인사이트 작성률"
  );
  drawLineChart(
    document.getElementById("persuasion-trend-chart"),
    persuasionTrend,
    "#f2b134",
    100,
    "%",
    "설득률"
  );
  drawLineChart(
    document.getElementById("insight-length-trend-chart"),
    insightLengthTrend,
    "#8b5cf6",
    Math.max(...insightLengthTrend.map((item) => item.value), 10),
    "자",
    "평균 인사이트 글자수"
  );
  drawLineChart(
    document.getElementById("engagement-trend-chart"),
    engagementTrend,
    "#2f8d72",
    100,
    "점",
    "몰입도지수"
  );
  drawMultiLineChart(
    document.getElementById("volume-trend-chart"),
    volumeLabels,
    [
      { label: "집계된 참여자 수", values: targetTrend, color: "#1f62ff" },
      { label: "실제 참여자 수", values: joinedTrend, color: "#e06d4f" },
      { label: "인사이트 작성자 수", values: insightCountTrend, color: "#5eb59a" }
    ],
    Math.max(...targetTrend, ...joinedTrend, ...insightCountTrend, 5),
    "명"
  );
  drawMultiLineChart(
    document.getElementById("intensity-trend-chart"),
    volumeLabels,
    [
      { label: "평균 참여 시간", values: durationCompareTrend, color: "#31404f" },
      { label: "찬반 팽팽함", values: balanceCompareTrend, color: "#f2b134" },
      { label: "설득된 사람 수", values: persuadedCountTrend, color: "#e06d4f" }
    ],
    100,
    "점"
  );
  drawMultiLineChart(
    document.getElementById("weekday-trend-chart"),
    weekdayStats.map((item) => item.label),
    [
      { label: "참여율", values: weekdayStats.map((item) => item.participationRate), color: "#e06d4f" },
      { label: "평균 체류시간", values: weekdayStats.map((item) => item.durationScore), color: "#31404f" },
      { label: "인사이트 작성률", values: weekdayStats.map((item) => item.insightRate), color: "#5eb59a" }
    ],
    100,
    "%",
    true
  );
  renderWeekdayStats(weekdayStats);
  drawMultiLineChart(
    document.getElementById("weekly-trend-chart"),
    weeklyStats.map((item) => item.label),
    [
      { label: "참여율", values: weeklyStats.map((item) => item.participationRate), color: "#e06d4f" },
      { label: "평균 체류시간", values: weeklyStats.map((item) => item.durationScore), color: "#31404f" },
      { label: "인사이트 작성률", values: weeklyStats.map((item) => item.insightRate), color: "#5eb59a" }
    ],
    100,
    "%",
    true
  );
  renderWeeklyStats(weeklyStats);
}

function getAverageInsightLengthForDebate(debate) {
  const insightLengths = (debate.participants ?? [])
    .map((participant) => getInsightLength(participant.insightText))
    .filter((value) => value > 0);
  return insightLengths.length ? Math.round(average(insightLengths)) : 0;
}

function normalizeSeries(values) {
  const max = Math.max(...values, 0);
  if (max <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => Math.round((value / max) * 100));
}

function buildWeekdayStats(chronological) {
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const grouped = new Map(weekdays.map((label) => [label, []]));

  chronological.forEach((debate) => {
    const day = weekdays[new Date(debate.startTime).getDay()];
    grouped.get(day).push(debate);
  });

  const durationAverages = [];
  const stats = weekdays.map((label) => {
    const items = grouped.get(label);
    const participationRate = items.length
      ? average(items.map((item) => item.metrics.participationRate))
      : 0;
    const avgDuration = items.length
      ? average(items.map((item) => item.avgDurationMin))
      : 0;
    const insightRate = items.length
      ? average(items.map((item) => item.metrics.insightRate))
      : 0;
    durationAverages.push(avgDuration);
    return {
      label,
      participationRate: Math.round(participationRate),
      avgDuration,
      insightRate: Math.round(insightRate)
    };
  });

  const normalizedDurations = normalizeSeries(durationAverages);
  return stats.map((item, index) => ({
    ...item,
    durationScore: normalizedDurations[index]
  }));
}

function buildWeeklyStats(chronological) {
  const grouped = new Map();

  chronological.forEach((debate) => {
    const end = new Date(new Date(debate.startTime).getTime() + 24 * 60 * 60 * 1000);
    const monday = mondayClosingOfWeek(end);
    const key = monday.toISOString().slice(0, 10);
    const current = grouped.get(key) ?? {
      key,
      label: formatWeekLabel(monday),
      items: []
    };
    current.items.push(debate);
    grouped.set(key, current);
  });

  const groups = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
  const durationAverages = [];
  const stats = groups.map((group) => {
    const participationRate = average(group.items.map((item) => item.metrics.participationRate));
    const avgDuration = average(group.items.map((item) => item.avgDurationMin));
    const insightRate = average(group.items.map((item) => item.metrics.insightRate));
    durationAverages.push(avgDuration);
    return {
      label: group.label,
      participationRate: Math.round(participationRate),
      avgDuration,
      insightRate: Math.round(insightRate)
    };
  });

  const normalizedDurations = normalizeSeries(durationAverages);
  return stats.map((item, index) => ({
    ...item,
    durationScore: normalizedDurations[index]
  }));
}

function mondayClosingOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(18, 0, 0, 0);
  return copy;
}

function formatWeekLabel(monday) {
  const month = monday.getMonth() + 1;
  const day = monday.getDate();
  return `${month}.${String(day).padStart(2, "0")} 마감 주간`;
}

function renderWeeklyStats(weeklyStats) {
  const list = document.getElementById("weekly-stat-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  weeklyStats.forEach((item) => {
    const card = document.createElement("div");
    card.className = "weekday-stat-item";
    card.innerHTML = `
      <strong>${item.label}</strong>
      <span>참여율 ${item.participationRate}%</span>
      <span>평균 체류 ${Math.round(item.avgDuration)}분</span>
      <span>인사이트 작성률 ${item.insightRate}%</span>
    `;
    list.appendChild(card);
  });
}

function renderParticipantProfiles(withMetrics) {
  const table = document.getElementById("profiles-table");
  const summary = document.getElementById("profiles-summary-pill");
  const pagination = document.getElementById("profiles-pagination");
  if (!table || !summary || !pagination) {
    return;
  }

  const participantTotals = aggregateParticipantTotals(withMetrics);
  const profileMap = new Map(
    participantTotals.map((item) => [
      item.nickname,
      {
        ...item,
        proCount: 0,
        conCount: 0,
        oppositionRate: 0,
        bestSelectionRate: 0,
        latestHeartbeat: ""
      }
    ])
  );

  withMetrics.forEach((debate) => {
    (debate.participants ?? []).forEach((participant) => {
      if (!profileMap.has(participant.nickname)) {
        return;
      }

      const normalizedNickname = String(participant.nickname ?? "").trim().toLowerCase();
      const isRoleOwner =
        normalizedNickname &&
        (normalizedNickname === String(debate.agendaSetter ?? "").trim().toLowerCase() ||
          normalizedNickname === String(debate.architect ?? "").trim().toLowerCase());
      if (isRoleOwner) {
        return;
      }

      const current = profileMap.get(participant.nickname);
      if (participant.side === "찬성") {
        current.proCount += 1;
      }
      if (participant.side === "반대") {
        current.conCount += 1;
      }
      if (participant.lastHeartbeat && participant.lastHeartbeat > current.latestHeartbeat) {
        current.latestHeartbeat = participant.lastHeartbeat;
      }
    });
  });

  const sortableColumns = [
    { key: "nickname", label: "이름" },
    { key: "joinedCount", label: "참여" },
    { key: "proCount", label: "찬성" },
    { key: "conCount", label: "반대" },
    { key: "oppositionRate", label: "반대율" },
    { key: "totalDuration", label: "총 체류" },
    { key: "averageDurationPerDebate", label: "평균 체류" },
    { key: "averageInsightLength", label: "평균 글자수" },
    { key: "durationCv", label: "참여 안정도" },
    { key: "bestSelectionRate", label: "베스트선정률" },
    { key: "insightCount", label: "인사이트" },
    { key: "persuadedCount", label: "설득" },
    { key: "bestInsightCount", label: "베스트" },
    { key: "sincerityScore", label: "진심지수" }
  ];
  const metricColumns = sortableColumns.filter((item) => item.key !== "nickname");

  const profiles = [...profileMap.values()]
    .map((item) => ({
      ...item,
      oppositionRate:
        item.proCount + item.conCount ? Math.round((item.conCount / (item.proCount + item.conCount)) * 100) : 0,
      bestSelectionRate: item.insightCount
        ? Math.round((item.bestInsightCount / item.insightCount) * 100)
        : 0
    }))
    .sort((a, b) => compareProfileRows(a, b));

  const currentSort = sortableColumns.find((item) => item.key === profilesSort.key);
  summary.textContent = `${profiles.length}명 프로필 · ${currentSort?.label ?? "진심지수"} ${
    profilesSort.direction === "asc" ? "오름차순" : "내림차순"
  }`;

  if (!profiles.length) {
    table.innerHTML = `<div class="data-status">표시할 참여자 프로필이 없습니다.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(metricColumns.length / profilesPagination.perPage));
  profilesPagination.page = Math.min(profilesPagination.page, totalPages);
  const startIndex = (profilesPagination.page - 1) * profilesPagination.perPage;
  const visibleMetricColumns = metricColumns.slice(
    startIndex,
    startIndex + profilesPagination.perPage
  );
  const gridTemplate = `120px 260px repeat(${visibleMetricColumns.length}, minmax(84px, 1fr))`;

  const header = `
    <div class="profiles-row is-head" style="grid-template-columns:${gridTemplate};">
      <button class="profiles-head-cell is-sortable${profilesSort.key === "nickname" ? " is-active" : ""}" data-profiles-sort="nickname" type="button">이름${renderProfilesSortArrow("nickname")}</button>
      <div class="profiles-head-cell">칭호</div>
      ${visibleMetricColumns
        .map(
          (column) =>
            `<button class="profiles-head-cell is-sortable${profilesSort.key === column.key ? " is-active" : ""}" data-profiles-sort="${column.key}" type="button">${column.label}${renderProfilesSortArrow(
              column.key
            )}</button>`
        )
        .join("")}
    </div>
  `;

  const rows = profiles
    .map((profile) => {
      const badges = getParticipantTitleBadgesData(profile.nickname, withMetrics, participantTotals);
      const valueMap = {
        joinedCount: `${profile.joinedCount}`,
        proCount: `${profile.proCount}`,
        conCount: `${profile.conCount}`,
        oppositionRate: `${profile.oppositionRate}%`,
        totalDuration: `${profile.totalDuration}분`,
        averageDurationPerDebate: `${profile.averageDurationPerDebate}분`,
        averageInsightLength: `${profile.averageInsightLength}자`,
        durationCv: `${profile.durationCv.toFixed(2)}`,
        bestSelectionRate: `${profile.bestSelectionRate}%`,
        insightCount: `${profile.insightCount}`,
        persuadedCount: `${profile.persuadedCount}`,
        bestInsightCount: `${profile.bestInsightCount}`,
        sincerityScore: `${profile.sincerityScore}점`
      };
      return `
        <div class="profiles-row" style="grid-template-columns:${gridTemplate};">
          <div class="profiles-name">
            <button class="profiles-name-button" type="button" data-profile-open="${escapeHtml(
              profile.nickname
            )}">${escapeHtml(profile.nickname)}</button>
            <span class="profiles-subtext">${formatHeartbeatLabel(profile.latestHeartbeat)}</span>
          </div>
          <div class="profiles-badges">
            ${
              badges.length
                ? badges
                    .map(
                      (badge) =>
                        `<span class="profiles-badge${badge.highlight ? " is-highlight" : ""}">${escapeHtml(
                          badge.label
                        )}</span>`
                    )
                    .join("")
                : `<span class="profiles-badge">기록 축적 중</span>`
            }
          </div>
          ${visibleMetricColumns
            .map((column) => {
              const strongKeys = new Set(["joinedCount", "totalDuration", "sincerityScore"]);
              return `<div class="${strongKeys.has(column.key) ? "profiles-cell-strong" : "profiles-cell"}">${
                valueMap[column.key]
              }</div>`;
            })
            .join("")}
        </div>
      `;
    })
    .join("");

  table.innerHTML = `${header}${rows}`;
  table.querySelectorAll("[data-profile-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openParticipantModal(button.dataset.profileOpen);
    });
  });
  table.querySelectorAll("[data-profiles-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.profilesSort;
      if (profilesSort.key === key) {
        profilesSort.direction = profilesSort.direction === "asc" ? "desc" : "asc";
      } else {
        profilesSort.key = key;
        profilesSort.direction = key === "nickname" ? "asc" : "desc";
      }
      renderParticipantProfiles(withMetrics);
    });
  });
  pagination.innerHTML = `
    <div class="profiles-pagination-info">지표 ${startIndex + 1}-${Math.min(
      startIndex + profilesPagination.perPage,
      metricColumns.length
    )} / ${metricColumns.length}</div>
    <div class="profiles-pagination-actions">
      <button class="profiles-page-button" type="button" data-profiles-page="prev" ${
        profilesPagination.page === 1 ? "disabled" : ""
      }>이전</button>
      <button class="profiles-page-button" type="button" data-profiles-page="next" ${
        profilesPagination.page === totalPages ? "disabled" : ""
      }>다음</button>
    </div>
  `;
  pagination.querySelectorAll("[data-profiles-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.profilesPage;
      if (action === "prev" && profilesPagination.page > 1) {
        profilesPagination.page -= 1;
      }
      if (action === "next" && profilesPagination.page < totalPages) {
        profilesPagination.page += 1;
      }
      renderParticipantProfiles(withMetrics);
    });
  });
}

function renderProfilesSortArrow(key) {
  if (profilesSort.key !== key) {
    return '<span class="profiles-sort-arrow">↕</span>';
  }
  return `<span class="profiles-sort-arrow">${profilesSort.direction === "asc" ? "↑" : "↓"}</span>`;
}

function compareProfileRows(a, b) {
  const { key, direction } = profilesSort;
  const multiplier = direction === "asc" ? 1 : -1;
  if (key === "nickname") {
    return a.nickname.localeCompare(b.nickname, "ko") * multiplier;
  }

  const aValue = Number(a[key] ?? 0);
  const bValue = Number(b[key] ?? 0);
  if (aValue !== bValue) {
    return (aValue - bValue) * multiplier;
  }
  return a.nickname.localeCompare(b.nickname, "ko");
}

function getParticipantTitleBadgesData(nickname, withMetrics, participantTotalsInput) {
  const participantTotals = participantTotalsInput ?? aggregateParticipantTotals(withMetrics);
  const agendaSetterTotals = aggregateRoleTotals(
    withMetrics,
    "agendaSetter",
    (current, debate) => {
      current.scoreTotal += debate.avgDurationMin ?? 0;
      current.metricValue = Math.round(current.scoreTotal / current.count);
    }
  );
  const architectTotals = aggregateRoleTotals(
    withMetrics,
    "architect",
    (current, debate) => {
      current.scoreTotal += debate.persuasiveCount ?? 0;
      current.metricValue = current.scoreTotal;
    }
  );
  const combinedRoleTotals = aggregateCombinedRoleTotals(
    withMetrics,
    agendaSetterTotals,
    architectTotals,
    participantTotals
  ).sort((a, b) => b.totalScore - a.totalScore);

  const configs = [
    {
      label: "진심",
      items: [...participantTotals].sort((a, b) => b.sincerityScore - a.sincerityScore),
      key: "nickname"
    },
    {
      label: "장기 몰입",
      items: [...participantTotals].sort((a, b) => b.totalDuration - a.totalDuration),
      key: "nickname"
    },
    {
      label: "인사이트",
      items: [...participantTotals].sort((a, b) => b.insightCount - a.insightCount),
      key: "nickname"
    },
    {
      label: "베스트",
      items: [...participantTotals].sort((a, b) => b.bestInsightCount - a.bestInsightCount),
      key: "nickname"
    },
    {
      label: "안정도",
      items: [...participantTotals]
        .filter((item) => item.joinedCount >= 3)
        .sort((a, b) => a.durationCv - b.durationCv),
      key: "nickname"
    },
    {
      label: "아젠다",
      items: [...agendaSetterTotals].sort((a, b) => b.metricValue - a.metricValue),
      key: "name"
    },
    {
      label: "아키텍트",
      items: [...architectTotals].sort((a, b) => b.metricValue - a.metricValue),
      key: "name"
    },
    {
      label: "역할 종합",
      items: combinedRoleTotals,
      key: "name"
    }
  ];

  const badges = [];
  configs.forEach((config) => {
    const index = config.items.findIndex((item) => item[config.key] === nickname);
    if (index < 0 || index > 2) {
      return;
    }
    badges.push({
      label: `${config.label} ${index + 1}위`,
      highlight: index === 0
    });
  });

  return badges.slice(0, 5);
}

function renderRankings(withMetrics) {
  const rankingGrid = document.getElementById("ranking-grid");
  const participantRankingGrid = document.getElementById("participant-ranking-grid");
  const roleRankingGrid = document.getElementById("role-ranking-grid");
  if (!rankingGrid) {
    return;
  }

  const participantTotals = aggregateParticipantTotals(withMetrics);

  const rankings = [
    {
      eyebrow: "Longest Debate",
      title: "가장 오래 토론이 이루어진 토론",
      items: [...withMetrics]
        .sort((a, b) => b.avgDurationMin - a.avgDurationMin)
        .map((item) => ({
          name: item.title || "(제목 없음)",
          value: `${item.avgDurationMin}분`,
          meta: `${item.period} · 평균 체류 기준`
        }))
    },
    {
      eyebrow: "Closest Vote",
      title: "가장 찬반이 비슷했던 토론",
      items: [...withMetrics]
        .sort(
          (a, b) => Math.abs(a.proCount - a.conCount) - Math.abs(b.proCount - b.conCount)
        )
        .map((item) => ({
          name: item.title || "(제목 없음)",
          value: `${item.proCount}:${item.conCount}`,
          meta: `${item.period} · 표 차이 ${Math.abs(item.proCount - item.conCount)}표`
        }))
    },
    {
      eyebrow: "Deepest Participant",
      title: "토론당 평균참여 시간이 긴 참여자",
      items: [...participantTotals]
        .sort((a, b) => b.averageDurationPerDebate - a.averageDurationPerDebate)
        .map((item) => ({
          name: item.nickname,
          value: `${item.averageDurationPerDebate}분`,
          meta: `총 ${item.joinedCount}개 토론 참여 · 누적 ${item.totalDuration}분`
        }))
    }
  ];

  rankingGrid.innerHTML = "";
  rankings.forEach((section) => {
    const card = document.createElement("article");
    card.className = "ranking-card";
    card.innerHTML = `
      <p class="eyebrow">${section.eyebrow}</p>
      <h3>${section.title}</h3>
      <div class="ranking-list">
        ${section.items
          .map(
            (item, index) => `
              <div class="ranking-item">
                <div class="ranking-item-left">
                  ${renderRankingBadge(index)}
                  <div>
                    <div class="ranking-name">${item.name}</div>
                    <div class="ranking-meta">${item.meta}</div>
                  </div>
                </div>
                <strong>${item.value}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    rankingGrid.appendChild(card);
  });

  if (!participantRankingGrid) {
    return;
  }

  const participantRankings = [
    {
      eyebrow: "Time on Debate",
      title: "토론 오래 참여한 순서",
      items: buildRankingItems(participantTotals, (a, b) => b.totalDuration - a.totalDuration, (item) => ({
        name: item.nickname,
        value: `${item.totalDuration}분`,
        meta: `${item.joinedCount}개 토론 참여`
      }), participantTotals.length)
    },
    {
      eyebrow: "Persuaded Count",
      title: "설득된 횟수 순서",
      items: buildRankingItems(participantTotals, (a, b) => b.persuadedCount - a.persuadedCount, (item) => ({
        name: item.nickname,
        value: `${item.persuadedCount}회`,
        meta: `${item.insightCount}회 인사이트 작성`
      }), participantTotals.length)
    },
    {
      eyebrow: "Insight Writers",
      title: "인사이트 작성 많은 순서",
      items: buildRankingItems(participantTotals, (a, b) => b.insightCount - a.insightCount, (item) => ({
        name: item.nickname,
        value: `${item.insightCount}회`,
        meta: `${item.totalDuration}분 체류`
      }), participantTotals.length)
    },
    {
      eyebrow: "Above Average Time",
      title: "평균보다 오래 참여한 횟수",
      items: buildRankingItems(participantTotals, (a, b) => b.aboveAverageCount - a.aboveAverageCount, (item) => ({
        name: item.nickname,
        value: `${item.aboveAverageCount}회`,
        meta: `${item.joinedCount}개 토론 참여`
      }), participantTotals.length)
    },
    {
      eyebrow: "Best Insights",
      title: "베스트 인사이트 선정 횟수",
      items: buildRankingItems(participantTotals, (a, b) => b.bestInsightCount - a.bestInsightCount, (item) => ({
        name: item.nickname,
        value: `${item.bestInsightCount}회`,
        meta: `${item.insightCount}회 인사이트 작성`
      }), participantTotals.length)
    },
    {
      eyebrow: "Insight Length",
      title: "평균 인사이트 글자수",
      items: buildRankingItems(participantTotals, (a, b) => b.averageInsightLength - a.averageInsightLength, (item) => ({
        name: item.nickname,
        value: `${item.averageInsightLength}자`,
        meta: `${item.insightCount}회 인사이트 작성`
      }), participantTotals.length)
    },
    {
      eyebrow: "Sincerity Index",
      title: "진심지수",
      items: buildRankingItems(participantTotals, (a, b) => b.sincerityScore - a.sincerityScore, (item) => ({
        name: item.nickname,
        value: `${item.sincerityScore}점`,
        meta: `${item.totalDuration}분 체류 · 인사이트 ${item.insightCount}회`
      }), participantTotals.length)
    },
    {
      eyebrow: "Consistency",
      title: "참여 안정도 랭킹",
      items: buildRankingItems(
        participantTotals.filter((item) => item.joinedCount >= 3),
        (a, b) => a.durationCv - b.durationCv,
        (item) => ({
          name: item.nickname,
          value: `CV ${item.durationCv.toFixed(2)}`,
          meta: `최소 ${item.minDuration}분 · 최대 ${item.maxDuration}분 · 격차 ${item.durationRange}분`
        }),
        participantTotals.length
      )
    }
  ];

  participantRankingGrid.innerHTML = "";
  participantRankings.forEach((section) => {
    const card = document.createElement("article");
    card.className = "ranking-card";
    card.innerHTML = `
      <p class="eyebrow">${section.eyebrow}</p>
      <h3>${section.title}</h3>
      <div class="ranking-list">
        ${section.items
          .map(
            (item, index) => `
              <div class="ranking-item">
                <div class="ranking-item-left">
                  ${renderRankingBadge(index)}
                  <div>
                    <div class="ranking-name">${item.name}</div>
                    <div class="ranking-meta">${item.meta}</div>
                  </div>
                </div>
                <strong>${item.value}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    participantRankingGrid.appendChild(card);
  });

  if (!roleRankingGrid) {
    return;
  }

  const agendaSetterTotals = aggregateRoleTotals(
    withMetrics,
    "agendaSetter",
    (current, debate) => {
      current.scoreTotal += debate.avgDurationMin ?? 0;
      current.metricValue = Math.round(current.scoreTotal / current.count);
    }
  );
  const architectTotals = aggregateRoleTotals(
    withMetrics,
    "architect",
    (current, debate) => {
      current.scoreTotal += debate.persuasiveCount ?? 0;
      current.metricValue = current.scoreTotal;
    }
  );
  const combinedRoleTotals = aggregateCombinedRoleTotals(
    withMetrics,
    agendaSetterTotals,
    architectTotals,
    participantTotals
  );

  const roleRankings = [
    {
      eyebrow: "Combined Roles",
      title: "아젠다 세터 + 아키텍트 종합 랭킹",
      items: combinedRoleTotals
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((item) => ({
          name: item.name,
          value: `${item.totalScore}점`,
          meta: `아젠다 ${item.agendaScore}점 · 아키텍트 ${item.architectScore}점 · 가산 ${item.bonusScore}점 · 패널티 ${item.penaltyScore}점`
        }))
    },
    {
      eyebrow: "Agenda Setters",
      title: "아젠다 세터 랭킹",
      items: agendaSetterTotals
        .sort((a, b) => b.metricValue - a.metricValue)
        .map((item) => ({
          name: item.name,
          value: `${item.metricValue}분`,
          meta: `${item.count}개 토론 평균 체류`
        }))
    },
    {
      eyebrow: "Architects",
      title: "아키텍트 랭킹",
      items: architectTotals
        .sort((a, b) => b.metricValue - a.metricValue)
        .map((item) => ({
          name: item.name,
          value: `${item.metricValue}명`,
          meta: `${item.count}개 토론 설득 인원 합계`
        }))
    }
  ];

  roleRankingGrid.innerHTML = "";
  roleRankings.forEach((section) => {
    const card = document.createElement("article");
    card.className = "ranking-card";
    card.innerHTML = `
      <p class="eyebrow">${section.eyebrow}</p>
      <h3>${section.title}</h3>
      <div class="ranking-list">
        ${section.items
          .map(
            (item, index) => `
              <div class="ranking-item">
                <div class="ranking-item-left">
                  ${renderRankingBadge(index)}
                  <div>
                    <div class="ranking-name">${item.name}</div>
                    <div class="ranking-meta">${item.meta}</div>
                  </div>
                </div>
                <strong>${item.value}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    roleRankingGrid.appendChild(card);
  });
}

function buildRankingItems(participantTotals, sorter, formatter, limit = 5) {
  return [...participantTotals]
    .sort(sorter)
    .slice(0, limit)
    .map(formatter);
}

function renderRankingBadge(index) {
  if (index === 0) {
    return `<span class="ranking-rank rank-gold">🥇</span>`;
  }
  if (index === 1) {
    return `<span class="ranking-rank rank-silver">🥈</span>`;
  }
  if (index === 2) {
    return `<span class="ranking-rank rank-bronze">🥉</span>`;
  }
  return `<span class="ranking-rank">${index + 1}</span>`;
}

function computeParticipantSincerityScores(participantTotals) {
  const maxima = {
    totalDuration: Math.max(...participantTotals.map((item) => item.totalDuration), 1),
    aboveAverageCount: Math.max(...participantTotals.map((item) => item.aboveAverageCount), 1),
    insightCount: Math.max(...participantTotals.map((item) => item.insightCount), 1),
    averageInsightLength: Math.max(...participantTotals.map((item) => item.averageInsightLength), 1),
    bestInsightCount: Math.max(...participantTotals.map((item) => item.bestInsightCount), 1),
    persuadedCount: Math.max(...participantTotals.map((item) => item.persuadedCount), 1)
  };

  return participantTotals.map((item) => {
    const totalDurationScore = (item.totalDuration / maxima.totalDuration) * 25;
    const aboveAverageScore = (item.aboveAverageCount / maxima.aboveAverageCount) * 20;
    const insightScore = (item.insightCount / maxima.insightCount) * 20;
    const insightLengthScore = (item.averageInsightLength / maxima.averageInsightLength) * 15;
    const bestInsightScore = (item.bestInsightCount / maxima.bestInsightCount) * 10;
    const persuadedScore = (item.persuadedCount / maxima.persuadedCount) * 10;
    return {
      ...item,
      sincerityScore: Math.round(
        totalDurationScore +
          aboveAverageScore +
          insightScore +
          insightLengthScore +
          bestInsightScore +
          persuadedScore
      )
    };
  });
}

function aggregateParticipantTotals(withMetrics) {
  const totals = new Map();
  withMetrics.forEach((debate) => {
    (debate.participants ?? []).forEach((participant) => {
      const normalizedNickname = String(participant.nickname ?? "").trim().toLowerCase();
      const isRoleOwner =
        normalizedNickname &&
        (normalizedNickname === String(debate.agendaSetter ?? "").trim().toLowerCase() ||
          normalizedNickname === String(debate.architect ?? "").trim().toLowerCase());

      if (isRoleOwner) {
        return;
      }

      const current = totals.get(participant.nickname) ?? {
        nickname: participant.nickname,
        totalDuration: 0,
        joinedCount: 0,
        insightCount: 0,
        persuadedCount: 0,
        aboveAverageCount: 0,
        bestInsightCount: 0,
        insightLengthTotal: 0,
        averageInsightLength: 0
      };

      if (!isRoleOwner) {
        current.totalDuration += participant.durationMin ?? 0;
        if (participant.joined) {
          current.joinedCount += 1;
          current.durationSamples = current.durationSamples ?? [];
          current.durationSamples.push(participant.durationMin ?? 0);
        }
      }

      if (participant.insight) {
        current.insightCount += 1;
        current.insightLengthTotal += getInsightLength(participant.insightText);
      }
      if (participant.persuaded) {
        current.persuadedCount += 1;
      }
      if (!isRoleOwner && (participant.durationMin ?? 0) > (debate.avgDurationMin ?? 0)) {
        current.aboveAverageCount += 1;
      }
      if (participant.bestInsight) {
        current.bestInsightCount += 1;
      }
      totals.set(participant.nickname, current);
    });
  });
  return computeParticipantSincerityScores(
    [...totals.values()].map((item) => ({
      ...item,
      minDuration: item.durationSamples?.length ? Math.min(...item.durationSamples) : 0,
      maxDuration: item.durationSamples?.length ? Math.max(...item.durationSamples) : 0,
      durationRange: item.durationSamples?.length
        ? Math.max(...item.durationSamples) - Math.min(...item.durationSamples)
        : 0,
      durationStdDev: calculateStdDev(item.durationSamples ?? []),
      durationCv:
        item.durationSamples?.length && item.joinedCount && item.totalDuration > 0
          ? calculateStdDev(item.durationSamples) / (item.totalDuration / item.joinedCount)
          : 0,
      averageDurationPerDebate: item.joinedCount
        ? Math.round(item.totalDuration / item.joinedCount)
        : 0,
      averageInsightLength: item.insightCount
        ? Math.round(item.insightLengthTotal / item.insightCount)
        : 0
    }))
  );
}

function aggregateRoleTotals(withMetrics, key, updater) {
  const totals = new Map();
  withMetrics.forEach((debate) => {
    const rawName = String(debate[key] ?? "").trim();
    if (!rawName || rawName.toLowerCase() === "gregory") {
      return;
    }

    const current = totals.get(rawName) ?? {
      name: rawName,
      count: 0,
      scoreTotal: 0,
      metricValue: 0
    };
    current.count += 1;
    updater(current, debate);
    totals.set(rawName, current);
  });
  return [...totals.values()];
}

function calculateStdDev(values) {
  if (!values.length) {
    return 0;
  }
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function aggregateCombinedRoleTotals(withMetrics, agendaSetterTotals, architectTotals, participantTotals) {
  const bonusMap = aggregateRoleBonusScores();
  const eligibleDebates = withMetrics;
  const participantTotalsMap = new Map(
    participantTotals.map((item) => [String(item.nickname).trim(), item])
  );

  const agendaRankMap = buildRankScoreMap(
    [...agendaSetterTotals].sort((a, b) => b.metricValue - a.metricValue)
  );
  const architectRankMap = buildRankScoreMap(
    [...architectTotals].sort((a, b) => b.metricValue - a.metricValue)
  );

  const names = new Set([
    ...agendaRankMap.keys(),
    ...architectRankMap.keys(),
    ...bonusMap.keys()
  ]);

  return [...names]
    .filter((name) => name && name.toLowerCase() !== "gregory")
    .map((name) => {
      const agendaScore = agendaRankMap.get(name) ?? 0;
      const architectScore = architectRankMap.get(name) ?? 0;
      const participant = participantTotalsMap.get(name) ?? {
        joinedCount: 0,
        insightCount: 0,
        bestInsightCount: 0
      };
      const bonusScore = (bonusMap.get(name) ?? 0) + (participant.bestInsightCount ?? 0);
      const missingParticipationCount = Math.max(eligibleDebates.length - (participant.joinedCount ?? 0), 0);
      const missingInsightCount = Math.max(eligibleDebates.length - (participant.insightCount ?? 0), 0);
      const penaltyScore = Number(((missingParticipationCount + missingInsightCount) * 0.5).toFixed(1));
      return {
        name,
        agendaScore,
        architectScore,
        bonusScore,
        penaltyScore,
        totalScore: Number((agendaScore + architectScore + bonusScore - penaltyScore).toFixed(1))
      };
    });
}

function buildRankScoreMap(sortedTotals) {
  const scores = new Map();
  sortedTotals.forEach((item, index) => {
    scores.set(item.name, Math.max(50 - index * 2, 0));
  });
  return scores;
}

function aggregateRoleBonusScores() {
  const specialDateKeys = new Set(["2026-04-02", "2026-04-03", "2026-04-04"]);
  const totals = new Map();

  debates.forEach((debate) => {
    const dateKey = String(debate.startTime ?? "").slice(0, 10);
    if (!specialDateKeys.has(dateKey)) {
      return;
    }

    [debate.agendaSetter, debate.architect].forEach((rawName) => {
      const name = String(rawName ?? "").trim();
      if (!name || name.toLowerCase() === "gregory") {
        return;
      }
      totals.set(name, (totals.get(name) ?? 0) + 2);
    });
  });

  return totals;
}

function drawLineChart(svg, points, color, maxOverride = 100, suffix = "%", seriesLabel = "지표") {
  const width = computeResponsiveChartWidth(points.length);
  const height = 240;
  const padding = { top: 24, right: 24, bottom: 42, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(maxOverride, ...points.map((point) => point.value), 1);
  const minValue = 0;

  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.maxWidth = "none";

  const ns = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(ns, "g");
  svg.appendChild(group);

  [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio)).forEach((tick) => {
    const y = padding.top + innerHeight - ((tick - minValue) / (maxValue - minValue)) * innerHeight;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(padding.left));
    line.setAttribute("x2", String(width - padding.right));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "rgba(29, 27, 24, 0.12)");
    line.setAttribute("stroke-width", "1");
    group.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", "10");
    label.setAttribute("y", String(y + 4));
    label.setAttribute("fill", "#6f675f");
    label.setAttribute("font-size", "12");
    label.textContent = `${tick}${suffix}`;
    group.appendChild(label);
  });

  if (!points.length) {
    return;
  }

  const coords = points.map((point, index) => {
    const x =
      padding.left +
      (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y =
      padding.top + innerHeight - ((point.value - minValue) / (maxValue - minValue)) * innerHeight;
    return { ...point, x, y };
  });

  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ")
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  group.appendChild(path);

  coords.forEach((coord) => {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(coord.x));
    dot.setAttribute("cy", String(coord.y));
    dot.setAttribute("r", "5");
    dot.setAttribute("fill", color);
    attachTooltip(dot, {
      label: coord.label,
      title: seriesLabel,
      value: `${Math.round(coord.value)}${suffix}`
    });
    group.appendChild(dot);

    if (shouldRenderAxisLabel(points.length, coords.indexOf(coord))) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", String(coord.x));
      label.setAttribute("y", String(height - 12));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#6f675f");
      label.setAttribute("font-size", "12");
      label.textContent = coord.label;
      group.appendChild(label);
    }
  });
}

function drawMultiLineChart(svg, labels, seriesList, maxOverride = 10, suffix = "", showPointLabels = false) {
  const width = computeResponsiveChartWidth(labels.length);
  const height = 240;
  const padding = { top: 24, right: 24, bottom: 42, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(maxOverride, 1);
  const minValue = 0;

  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.maxWidth = "none";

  const ns = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(ns, "g");
  svg.appendChild(group);

  [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio)).forEach((tick) => {
    const y = padding.top + innerHeight - ((tick - minValue) / (maxValue - minValue)) * innerHeight;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(padding.left));
    line.setAttribute("x2", String(width - padding.right));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "rgba(29, 27, 24, 0.12)");
    line.setAttribute("stroke-width", "1");
    group.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", "10");
    label.setAttribute("y", String(y + 4));
    label.setAttribute("fill", "#6f675f");
    label.setAttribute("font-size", "12");
    label.textContent = `${tick}${suffix}`;
    group.appendChild(label);
  });

  labels.forEach((labelText, index) => {
    if (shouldRenderAxisLabel(labels.length, index)) {
      const x =
        padding.left +
        (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(height - 12));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#6f675f");
      label.setAttribute("font-size", "12");
      label.textContent = labelText;
      group.appendChild(label);
    }
  });

  seriesList.forEach((series) => {
    const coords = series.values.map((value, index) => {
      const x =
        padding.left +
        (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
      const y =
        padding.top + innerHeight - ((value - minValue) / (maxValue - minValue)) * innerHeight;
      return { x, y };
    });

    const path = document.createElementNS(ns, "path");
    path.setAttribute(
      "d",
      coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ")
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", series.color);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    group.appendChild(path);

    coords.forEach((coord) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(coord.x));
      dot.setAttribute("cy", String(coord.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", series.color);
      attachTooltip(dot, {
        label: labels[coords.indexOf(coord)] ?? "",
        title: series.label ?? "지표",
        value: `${series.values[coords.indexOf(coord)]}${suffix}`
      });
      group.appendChild(dot);

      if (showPointLabels) {
        const valueLabel = document.createElementNS(ns, "text");
        valueLabel.setAttribute("x", String(coord.x));
        valueLabel.setAttribute("y", String(coord.y - 10));
        valueLabel.setAttribute("text-anchor", "middle");
        valueLabel.setAttribute("fill", series.color);
        valueLabel.setAttribute("font-size", "11");
        valueLabel.textContent = `${series.values[coords.indexOf(coord)]}${suffix}`;
        group.appendChild(valueLabel);
      }
    });
  });
}

function ensureChartTooltip() {
  if (chartTooltip) {
    return chartTooltip;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.innerHTML = `
    <p class="chart-tooltip-label"></p>
    <p class="chart-tooltip-title"></p>
    <p class="chart-tooltip-value"></p>
  `;
  document.body.appendChild(tooltip);
  chartTooltip = tooltip;
  return tooltip;
}

function attachTooltip(node, content) {
  node.style.cursor = "pointer";
  node.addEventListener("mouseenter", (event) => {
    showChartTooltip(event, content);
  });
  node.addEventListener("mousemove", (event) => {
    moveChartTooltip(event);
  });
  node.addEventListener("mouseleave", hideChartTooltip);
}

function showChartTooltip(event, content) {
  const tooltip = ensureChartTooltip();
  tooltip.querySelector(".chart-tooltip-label").textContent = content.label ?? "";
  tooltip.querySelector(".chart-tooltip-title").textContent = content.title ?? "";
  tooltip.querySelector(".chart-tooltip-value").textContent = content.value ?? "";
  tooltip.classList.add("is-visible");
  moveChartTooltip(event);
}

function moveChartTooltip(event) {
  const tooltip = ensureChartTooltip();
  const offsetX = 16;
  const offsetY = 16;
  const tooltipWidth = tooltip.offsetWidth || 180;
  const tooltipHeight = tooltip.offsetHeight || 72;
  const maxLeft = window.innerWidth - tooltipWidth - 12;
  const maxTop = window.innerHeight - tooltipHeight - 12;
  const nextLeft = Math.min(event.clientX + offsetX, maxLeft);
  const nextTop = Math.min(event.clientY + offsetY, maxTop);
  tooltip.style.left = `${Math.max(12, nextLeft)}px`;
  tooltip.style.top = `${Math.max(12, nextTop)}px`;
}

function hideChartTooltip() {
  if (!chartTooltip) {
    return;
  }
  chartTooltip.classList.remove("is-visible");
}

function computeResponsiveChartWidth(count) {
  if (count <= 1) {
    return 640;
  }
  return Math.max(640, count * 72);
}

function shouldRenderAxisLabel(totalCount, index) {
  if (totalCount <= 8) {
    return true;
  }
  const step = totalCount <= 12 ? 2 : totalCount <= 18 ? 3 : 4;
  return index === 0 || index === totalCount - 1 || index % step === 0;
}

function renderWeekdayStats(weekdayStats) {
  const list = document.getElementById("weekday-stat-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  weekdayStats.forEach((item) => {
    const card = document.createElement("div");
    card.className = "weekday-stat-item";
    card.innerHTML = `
      <strong>${item.label}요일</strong>
      <span>참여율 ${item.participationRate}%</span>
      <span>평균 체류 ${Math.round(item.avgDuration)}분</span>
      <span>인사이트 작성률 ${item.insightRate}%</span>
    `;
    list.appendChild(card);
  });
}

function shortLabel(period) {
  return period.split(" ")[0];
}

function buildParticipantHistory(nickname) {
  return debates
    .map((debate) => {
      const participant = (debate.participants ?? []).find((item) => item.nickname === nickname);
      if (!participant) {
        return null;
      }
      return {
        title: debate.title,
        period: debate.period,
        durationMin: participant.durationMin ?? 0,
        avgDurationMin: debate.avgDurationMin ?? 0,
        lastHeartbeat: participant.lastHeartbeat ?? "",
        side: participant.side,
        insight: participant.insight,
        insightText: participant.insightText ?? "",
        insightLength: getInsightLength(participant.insightText),
        persuaded: participant.persuaded,
        bestInsight: participant.bestInsight
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.period.localeCompare(b.period, "ko"));
}

function openParticipantModal(nickname) {
  selectedParticipant = nickname;
  const history = buildParticipantHistory(nickname);
  const modal = document.getElementById("participant-modal");
  const displayName = nickname;
  const modalDebates = (
    visibleDebatesState?.length ? visibleDebatesState : debates.filter((item) => item.status !== "pending")
  ).map((debate) => ({
    ...debate,
    metrics: debate.metrics ?? computeMetrics(debate)
  }));
  const participantTotals = aggregateParticipantTotals(modalDebates);
  const titleBadges = getParticipantTitleBadgesData(nickname, modalDebates, participantTotals);
  const participantSummary = participantTotals.find((item) => item.nickname === nickname);
  const aboveAverageCount = history.filter((item) => item.durationMin > item.avgDurationMin).length;
  const insightRows = history.filter((item) => item.insight && item.insightLength > 0);
  const averageInsightLength = insightRows.length
    ? Math.round(average(insightRows.map((item) => item.insightLength)))
    : 0;
  const lastHeartbeat = history
    .map((item) => item.lastHeartbeat)
    .filter(Boolean)
    .sort()
    .at(-1);

  document.getElementById("participant-modal-title").textContent = `${displayName} 히스토리`;
  document.getElementById("modal-title-badges").innerHTML = titleBadges
    .map(
      (badge) =>
        `<span class="title-badge${badge.highlight ? " is-highlight" : ""}">${escapeHtml(
          badge.label
        )}</span>`
    )
    .join("");
  document.getElementById("modal-joined-count").textContent = `${history.length}회`;
  document.getElementById("modal-insight-count").textContent = `${history.filter((item) => item.insight).length}회`;
  document.getElementById("modal-total-duration").textContent = `${history.reduce((sum, item) => sum + item.durationMin, 0)}분`;
  document.getElementById("modal-above-average-count").textContent = `${aboveAverageCount}회`;
  document.getElementById("modal-sincerity-score").textContent = `${participantSummary?.sincerityScore ?? 0}점`;
  document.getElementById("modal-average-insight-length").textContent = `${averageInsightLength}자`;
  document.getElementById("modal-last-heartbeat").textContent = formatHeartbeatLabel(lastHeartbeat);
  document.getElementById("modal-duration-summary").textContent =
    history.length > 0
      ? `평균 ${Math.round(history.reduce((sum, item) => sum + item.durationMin, 0) / history.length)}분`
      : "기록 없음";

  drawLineChart(
    document.getElementById("modal-duration-chart"),
    history.map((item) => ({ label: shortLabel(item.period), value: item.durationMin })),
    "#31404f",
    Math.max(...history.map((item) => item.durationMin), 10),
    "분"
  );

  const list = document.getElementById("modal-history-list");
  list.innerHTML = "";
  history.forEach((item) => {
    const sideClass =
      item.side === "찬성"
        ? "chip-tag-pro"
        : item.side === "반대"
        ? "chip-tag-con"
        : "chip-tag-joined";
    const row = document.createElement("article");
    row.className = "history-row";
    row.innerHTML = `
      <div>
        <h4 class="history-title">${item.title}</h4>
        <div class="history-meta">${item.period}</div>
        <div class="history-meta">마지막 활동 ${formatHeartbeatLabel(item.lastHeartbeat)}</div>
        <div class="history-insight">
          <p class="history-insight-label">인사이트 내용</p>
          <p class="history-insight-body">${
            item.insightText ? escapeHtml(item.insightText) : "이 날짜에는 작성된 인사이트가 없습니다."
          }</p>
        </div>
      </div>
      <div class="history-tags">
        <span class="chip-tag chip-tag-duration">체류 ${item.durationMin}분</span>
        ${item.side ? `<span class="chip-tag ${sideClass}">${item.side}</span>` : ""}
        ${item.insight ? '<span class="chip-tag chip-tag-insight">인사이트 작성</span>' : ""}
        ${item.persuaded ? '<span class="chip-tag chip-tag-persuaded">설득됨</span>' : ""}
        ${item.bestInsight ? '<span class="chip-tag chip-tag-best">베스트 인사이트</span>' : ""}
      </div>
    `;
    list.appendChild(row);
  });

  modal.hidden = false;
}

function closeParticipantModal() {
  document.getElementById("participant-modal").hidden = true;
  selectedParticipant = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInsightLength(text) {
  return String(text ?? "").trim().length;
}

function formatHeartbeatLabel(value) {
  if (!value) {
    return "기록 없음";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "기록 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

async function loadDebates() {
  const response = await fetch("./data/debates.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("집계 데이터를 불러오지 못했습니다.");
  }
  const payload = await response.json();
  debates = Array.isArray(payload.debates) ? payload.debates : [];
  globalKeywords = Array.isArray(payload.keywords) ? payload.keywords : [];
  renderOverview();
}

loadDebates().catch((error) => {
  document.getElementById("data-status").textContent =
    `집계 데이터 로딩 실패: ${error.message}`;
});

updateDurationFilterStatus();
const durationFilterToggle = document.getElementById("duration-filter-toggle");
if (durationFilterToggle) {
  durationFilterToggle.onclick = () => {
    exclude1004FromDuration = !exclude1004FromDuration;
    updateDurationFilterStatus();
    renderOverview();
  };
}
document.getElementById("participant-modal-close").addEventListener("click", closeParticipantModal);
document.querySelector("[data-close-modal='true']").addEventListener("click", closeParticipantModal);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && selectedParticipant) {
    closeParticipantModal();
  }
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;
    document.querySelectorAll(".tab-button").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === target);
    });

    if (debates.length) {
      renderOverview();
    }
  });
});
