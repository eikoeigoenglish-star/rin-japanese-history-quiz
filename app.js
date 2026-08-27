"use strict";

// =======================
// 設定
// =======================
const PERIODS = [
  {
    id: "ancient",
    label: "古代",
    file: "data/01-question-ancient.json"
  },
  {
    id: "medieval",
    label: "中世",
    file: "data/02-question-medieval.json"
  },
  {
    id: "early-modern",
    label: "近世",
    file: "data/03-question-early-modern.json"
  },
  {
    id: "modern",
    label: "近現代",
    file: "data/04-question-modern.json"
  }
];

// 易しい順。難易度不足時は近い難易度から補充する。
const DIFFICULTY_LEVELS = ["★★★", "★★", "★", "無"];
const DIFFICULTY_LABELS = {
  "★★★": "★★★",
  "★★": "★★",
  "★": "★",
  "無": "無印"
};

const PROFILE_DISTRIBUTIONS = {
  grade2: { "★★★": 4, "★★": 1, "★": 0, "無": 0 },
  grade1: { "★★★": 1, "★★": 2, "★": 1, "無": 1 }
};

const PROFILE_LABELS = {
  grade2: "歴検2級",
  grade1: "歴検1級",
  custom: "カスタム"
};

const FALLBACK_ORDER = {
  "★★★": ["★★", "★", "無"],
  "★★": ["★★★", "★", "無"],
  "★": ["★★", "無", "★★★"],
  "無": ["★", "★★", "★★★"]
};

const CHOICE_MARKERS = ["1", "2", "3", "4"];

const STORAGE_KEY = "rekishi-kentei-japanese-history-progress-v1";
const PROGRESS_STATUSES = [
  { id: "new", label: "未出題" },
  { id: "miss", label: "ミス" },
  { id: "hit", label: "ヒット" },
  { id: "double", label: "ダブル" },
  { id: "triple", label: "トリプル" }
];

// =======================
// 状態
// =======================
const state = {
  allQuestions: [],
  questions: [],
  answers: {},
  currentIndex: 0,
  customDistribution: { "★★★": 1, "★★": 2, "★": 1, "無": 1 },
  lastSettings: null,
  progress: {},
  progressCommitted: false,
  progressTransitions: {},
  isLoaded: false
};

// =======================
// 初期化
// =======================
async function init() {
  bindStaticEvents();
  state.progress = loadProgress();

  try {
    const periodResults = await Promise.all(PERIODS.map(loadPeriodQuestions));
    state.allQuestions = periodResults.flat();

    validateQuestions(state.allQuestions);
    pruneProgress();
    renderProblemSets();

    state.isLoaded = true;
    document.getElementById("data-status").textContent =
      `${state.allQuestions.length.toLocaleString("ja-JP")}問を読み込みました。`;

    updateCustomControls();
    updatePeriodSetAvailability();
    updateMasterySummary();
    updateStartState();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "問題データを読み込めませんでした。";

    document.getElementById("data-status").textContent = "問題データの読み込みに失敗しました。";
    showStartError(message);
    document.getElementById("start-btn").disabled = true;
    console.error(error);
  }
}

window.addEventListener("DOMContentLoaded", init);

async function loadPeriodQuestions(period) {
  const response = await fetch(period.file);

  if (!response.ok) {
    throw new Error(`${period.file} の読み込みに失敗しました（HTTP ${response.status}）。`);
  }

  const questions = await response.json();

  if (!Array.isArray(questions)) {
    throw new Error(`${period.file} の形式が配列ではありません。`);
  }

  return questions;
}

function validateQuestions(questions) {
  const ids = new Set();

  questions.forEach((question, index) => {
    const location = `${index + 1}件目`;

    if (!question || typeof question !== "object") {
      throw new Error(`${location}の問題データが不正です。`);
    }

    if (!question.id || ids.has(question.id)) {
      throw new Error(`${location}のIDが空、または重複しています。`);
    }
    ids.add(question.id);

    if (!PERIODS.some(period => period.label === question.period)) {
      throw new Error(`${question.id} の時代が不正です。`);
    }

    if (!/^\d{4}$/.test(String(question.questionNumber))) {
      throw new Error(`${question.id} の問題番号が4桁ではありません。`);
    }

    if (!DIFFICULTY_LEVELS.includes(question.difficulty)) {
      throw new Error(`${question.id} の難易度が不正です。`);
    }

    if (!Array.isArray(question.choices) || question.choices.length !== 4) {
      throw new Error(`${question.id} の選択肢が4つではありません。`);
    }

    if (!question.choices.includes(question.correct)) {
      throw new Error(`${question.id} の正解が選択肢に含まれていません。`);
    }
  });
}

function bindStaticEvents() {
  document.getElementById("start-btn").addEventListener("click", startExam);
  document.getElementById("next-btn").addEventListener("click", nextQuestion);
  document.getElementById("back-to-start-btn").addEventListener("click", backToStart);
  document.getElementById("reset-progress-btn").addEventListener("click", resetProgress);
  document.getElementById("custom-distribution").addEventListener("click", handleCustomCounterClick);
  document.addEventListener("change", handleSettingsChange);
  document.addEventListener("keydown", handleQuizKeydown);
}

// =======================
// 問題セット生成
// =======================
function renderProblemSets() {
  const container = document.getElementById("problem-set-list");
  container.innerHTML = "";

  PERIODS.forEach(period => {
    const periodQuestions = state.allQuestions.filter(
      question => question.period === period.label
    );
    const maxNumber = Math.max(
      ...periodQuestions.map(question => Number(question.questionNumber))
    );
    const ranges = createProblemSetRanges(maxNumber);

    const fieldset = document.createElement("fieldset");
    fieldset.className = "period-set-block";
    fieldset.dataset.periodId = period.id;

    const legend = document.createElement("legend");
    legend.className = "period-set-legend";

    const heading = document.createElement("span");
    heading.className = "period-set-name";
    heading.textContent = period.label;

    const count = document.createElement("span");
    count.id = `set-count-${period.id}`;
    count.className = "period-set-count";
    count.textContent = `${ranges.length} / ${ranges.length}選択`;

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "btn-ghost btn-small period-set-toggle";
    toggleButton.dataset.periodId = period.id;
    toggleButton.textContent = "すべて解除";
    toggleButton.addEventListener("click", togglePeriodSets);

    legend.append(heading, count, toggleButton);

    const chipGroup = document.createElement("div");
    chipGroup.className = "chip-group set-chip-group";

    ranges.forEach(range => {
      const id = `set-${period.id}-${range.start}-${range.end}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.name = "problem-set";
      input.value = `${period.id}:${range.start}-${range.end}`;
      input.dataset.periodId = period.id;
      input.dataset.start = String(range.start);
      input.dataset.end = String(range.end);
      input.checked = true;

      const label = document.createElement("label");
      label.className = "chip set-chip";
      label.htmlFor = id;
      label.textContent = `${pad4(range.start)}〜${pad4(range.end)}`;

      chipGroup.append(input, label);
    });

    fieldset.append(legend, chipGroup);
    container.appendChild(fieldset);
  });
}

function createProblemSetRanges(total) {
  if (!Number.isInteger(total) || total < 1) {
    return [];
  }

  if (total <= 100) {
    return [{ start: 1, end: total }];
  }

  const fullHundreds = Math.floor(total / 100);
  const remainder = total % 100;
  const ranges = [];

  if (remainder === 0) {
    for (let index = 0; index < fullHundreds; index += 1) {
      ranges.push({ start: index * 100 + 1, end: (index + 1) * 100 });
    }
    return ranges;
  }

  // 100問未満の端数は、直前のセットにまとめる。
  for (let index = 0; index < fullHundreds - 1; index += 1) {
    ranges.push({ start: index * 100 + 1, end: (index + 1) * 100 });
  }

  ranges.push({
    start: (fullHundreds - 1) * 100 + 1,
    end: total
  });

  return ranges;
}

function togglePeriodSets(event) {
  const periodId = event.currentTarget.dataset.periodId;
  const inputs = getProblemSetInputs(periodId);
  const allChecked = inputs.every(input => input.checked);

  inputs.forEach(input => {
    input.checked = !allChecked;
  });

  updatePeriodSetSummary(periodId);
  updateStartState();
}

function getProblemSetInputs(periodId) {
  return [
    ...document.querySelectorAll(
      `input[name="problem-set"][data-period-id="${periodId}"]`
    )
  ];
}

function updatePeriodSetAvailability() {
  PERIODS.forEach(period => {
    const periodInput = document.getElementById(`period-${period.id}`);
    const block = document.querySelector(
      `.period-set-block[data-period-id="${period.id}"]`
    );

    if (!block) {
      return;
    }

    block.disabled = !periodInput.checked;
    block.classList.toggle("is-disabled", !periodInput.checked);
    updatePeriodSetSummary(period.id);
  });
}

function updatePeriodSetSummary(periodId) {
  const inputs = getProblemSetInputs(periodId);
  const checkedCount = inputs.filter(input => input.checked).length;
  const count = document.getElementById(`set-count-${periodId}`);
  const toggle = document.querySelector(
    `.period-set-toggle[data-period-id="${periodId}"]`
  );

  if (count) {
    count.textContent = `${checkedCount} / ${inputs.length}選択`;
  }

  if (toggle) {
    toggle.textContent =
      inputs.length > 0 && inputs.every(input => input.checked)
        ? "すべて解除"
        : "すべて選択";
  }
}

// =======================
// 設定画面の状態更新
// =======================
function handleSettingsChange(event) {
  if (event.target.name === "profile") {
    const isCustom = event.target.value === "custom";
    document.getElementById("custom-distribution").hidden = !isCustom;
  }

  if (event.target.name === "period") {
    updatePeriodSetAvailability();
  }

  if (event.target.name === "problem-set") {
    updatePeriodSetSummary(event.target.dataset.periodId);
  }

  if (["profile", "period", "problem-set", "progress-status", "count"].includes(event.target.name)) {
    updateStartState();
  }
}

function handleCustomCounterClick(event) {
  const button = event.target.closest(".counter-btn");

  if (!button) {
    return;
  }

  const row = button.closest(".counter-row");
  const difficulty = row.dataset.difficulty;
  const action = button.dataset.action;
  const current = state.customDistribution[difficulty];
  const total = getCustomTotal();

  if (action === "decrease" && current > 0) {
    state.customDistribution[difficulty] -= 1;
  }

  if (action === "increase" && current < 5 && total < 5) {
    state.customDistribution[difficulty] += 1;
  }

  updateCustomControls();
  updateStartState();
}

function updateCustomControls() {
  document.querySelectorAll(".counter-row").forEach(row => {
    const difficulty = row.dataset.difficulty;
    const value = state.customDistribution[difficulty];
    const total = getCustomTotal();
    const output = row.querySelector(".counter-value");
    const decrease = row.querySelector('[data-action="decrease"]');
    const increase = row.querySelector('[data-action="increase"]');

    output.textContent = String(value);
    decrease.disabled = value === 0;
    increase.disabled = value === 5 || total >= 5;
  });

  const total = getCustomTotal();
  const totalOutput = document.getElementById("custom-total");
  const customError = document.getElementById("custom-error");

  totalOutput.textContent = `合計 ${total} / 5`;
  totalOutput.classList.toggle("is-invalid", total !== 5);
  customError.hidden = total === 5;
}

function getCustomTotal() {
  return DIFFICULTY_LEVELS.reduce(
    (sum, difficulty) => sum + state.customDistribution[difficulty],
    0
  );
}

function getSelectedPeriodIds() {
  return [
    ...document.querySelectorAll('input[name="period"]:checked')
  ].map(input => input.value);
}

function getSelectedRanges() {
  const selectedPeriods = new Set(getSelectedPeriodIds());

  return [
    ...document.querySelectorAll('input[name="problem-set"]:checked')
  ]
    .filter(input => selectedPeriods.has(input.dataset.periodId))
    .map(input => ({
      periodId: input.dataset.periodId,
      start: Number(input.dataset.start),
      end: Number(input.dataset.end)
    }));
}

function getScopePool() {
  const ranges = getSelectedRanges();
  const rangeMap = new Map();

  ranges.forEach(range => {
    if (!rangeMap.has(range.periodId)) {
      rangeMap.set(range.periodId, []);
    }
    rangeMap.get(range.periodId).push(range);
  });

  return state.allQuestions.filter(question => {
    const periodId = getPeriodIdByLabel(question.period);
    const periodRanges = rangeMap.get(periodId) || [];
    const number = Number(question.questionNumber);

    return periodRanges.some(
      range => number >= range.start && number <= range.end
    );
  });
}

function getSelectedProgressStatuses() {
  return [
    ...document.querySelectorAll('input[name="progress-status"]:checked')
  ].map(input => input.value);
}

function getFilteredPool() {
  const selectedStatuses = new Set(getSelectedProgressStatuses());

  return getScopePool().filter(
    question => selectedStatuses.has(getQuestionProgressStatus(question.id))
  );
}

function updateStartState() {
  if (!state.isLoaded) {
    return;
  }

  const scopePool = getScopePool();
  const pool = getFilteredPool();
  const selectedPeriods = getSelectedPeriodIds();
  const selectedRanges = getSelectedRanges();
  const selectedStatuses = getSelectedProgressStatuses();
  const profile = document.querySelector('input[name="profile"]:checked')?.value;
  const customIsValid = profile !== "custom" || getCustomTotal() === 5;

  updateMasterySummary();
  updateStatusFilterCounts(scopePool);
  updatePoolSummary(pool);
  updateAvailableCounts(pool.length);

  const selectedCount = Number(
    document.querySelector('input[name="count"]:checked')?.value || 0
  );

  const canStart =
    selectedPeriods.length > 0 &&
    selectedRanges.length > 0 &&
    selectedStatuses.length > 0 &&
    pool.length >= selectedCount &&
    selectedCount > 0 &&
    customIsValid;

  document.getElementById("start-btn").disabled = !canStart;

  if (canStart) {
    clearStartError();
    return;
  }

  if (selectedPeriods.length === 0) {
    showStartError("時代を1つ以上選択してください。");
  } else if (selectedRanges.length === 0) {
    showStartError("有効な問題セットを1つ以上選択してください。");
  } else if (selectedStatuses.length === 0) {
    showStartError("出題状態を1つ以上選択してください。");
  } else if (!customIsValid) {
    showStartError("カスタム配分の合計を5にしてください。");
  } else if (pool.length < selectedCount) {
    showStartError(`現在の対象は${pool.length}問です。出題問数を減らしてください。`);
  } else {
    clearStartError();
  }
}

function updateAvailableCounts(availableCount) {
  const countInputs = [
    ...document.querySelectorAll('input[name="count"]')
  ];

  countInputs.forEach(input => {
    input.disabled = Number(input.value) > availableCount;
  });

  const selectedInput = document.querySelector('input[name="count"]:checked');

  if (!selectedInput || selectedInput.disabled) {
    const largestAvailable = [...countInputs]
      .reverse()
      .find(input => !input.disabled);

    if (largestAvailable) {
      largestAvailable.checked = true;
    }
  }

  const availability = document.getElementById("count-availability");
  availability.textContent = availableCount > 0
    ? `1つ選択・現在の対象は${availableCount.toLocaleString("ja-JP")}問`
    : "出題対象がありません";
}

function updatePoolSummary(pool) {
  const counts = countByDifficulty(pool);
  document.getElementById("pool-total").textContent =
    `${pool.length.toLocaleString("ja-JP")}問`;

  const details = document.querySelectorAll("#pool-breakdown > div");
  DIFFICULTY_LEVELS.forEach((difficulty, index) => {
    details[index].querySelector("dd").textContent =
      counts[difficulty].toLocaleString("ja-JP");
  });
}

function countByDifficulty(questions) {
  const counts = { "★★★": 0, "★★": 0, "★": 0, "無": 0 };

  questions.forEach(question => {
    counts[question.difficulty] += 1;
  });

  return counts;
}

// =======================
// 試験開始と抽選
// =======================
function startExam() {
  clearStartError();

  const profile = document.querySelector('input[name="profile"]:checked')?.value;
  const questionCount = Number(
    document.querySelector('input[name="count"]:checked')?.value
  );
  const pool = getFilteredPool();

  if (!profile || !questionCount) {
    showStartError("難易度配分と出題問数を選択してください。");
    return;
  }

  if (profile === "custom" && getCustomTotal() !== 5) {
    showStartError("カスタム配分の合計を5にしてください。");
    return;
  }

  if (pool.length < questionCount) {
    showStartError(
      `現在の対象は${pool.length}問です。出題問数を${pool.length}問以下にしてください。`
    );
    return;
  }

  const distribution = getDistribution(profile);
  const selectedQuestions = selectQuestionsByDifficulty(
    pool,
    questionCount,
    distribution
  );

  state.questions = shuffle(selectedQuestions).map(question => ({
    ...question,
    displayChoices: shuffle(question.choices)
  }));
  state.answers = {};
  state.currentIndex = 0;
  state.progressCommitted = false;
  state.progressTransitions = {};
  state.lastSettings = {
    profile,
    profileLabel: PROFILE_LABELS[profile],
    questionCount
  };

  showScreen("screen-quiz");
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getDistribution(profile) {
  if (profile === "custom") {
    return { ...state.customDistribution };
  }

  return { ...PROFILE_DISTRIBUTIONS[profile] };
}

function selectQuestionsByDifficulty(pool, questionCount, distribution) {
  const multiplier = questionCount / 5;
  const buckets = Object.fromEntries(
    DIFFICULTY_LEVELS.map(difficulty => [
      difficulty,
      shuffle(pool.filter(question => question.difficulty === difficulty))
    ])
  );

  const selected = [];
  const shortages = [];

  DIFFICULTY_LEVELS.forEach(difficulty => {
    const target = distribution[difficulty] * multiplier;
    const exactCount = Math.min(target, buckets[difficulty].length);

    selected.push(...buckets[difficulty].splice(0, exactCount));

    for (let index = exactCount; index < target; index += 1) {
      shortages.push(difficulty);
    }
  });

  // 不足枠ごとに、隣接難易度を優先して補充する。
  shortages.forEach(requestedDifficulty => {
    const replacementDifficulty = FALLBACK_ORDER[requestedDifficulty]
      .find(difficulty => buckets[difficulty].length > 0);

    if (!replacementDifficulty) {
      throw new Error("出題対象が不足しているため、指定した問数を抽選できませんでした。");
    }

    selected.push(buckets[replacementDifficulty].shift());
  });

  if (selected.length !== questionCount) {
    throw new Error("問題抽選数が指定問数と一致しませんでした。");
  }

  return selected;
}

// Fisher-Yates shuffle
function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

// =======================
// 問題表示
// =======================
function renderQuestion() {
  const question = state.questions[state.currentIndex];
  const total = state.questions.length;
  const current = state.currentIndex + 1;

  document.getElementById("question-meta").textContent =
    `${question.period}・第${question.questionNumber}問・難易度 ${formatDifficulty(question.difficulty)}`;
  document.getElementById("question-counter").textContent = `${current} / ${total}`;

  updateProgress(current, total);

  const questionText = document.getElementById("question-text");
  questionText.textContent = cleanQuestionText(question.question);

  const answerArea = document.getElementById("answer-area");
  answerArea.innerHTML = "";
  renderChoices(answerArea, question);
  restoreAnswer(question);

  document.getElementById("next-btn").textContent =
    state.currentIndex === total - 1 ? "結果を見る" : "次へ";

  questionText.focus({ preventScroll: true });
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.getElementById("progress-bar").setAttribute("aria-valuenow", String(percent));
}

function renderChoices(area, question) {
  question.displayChoices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-btn";
    button.dataset.choice = choice;
    button.setAttribute("aria-pressed", "false");

    const marker = document.createElement("span");
    marker.className = "choice-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = CHOICE_MARKERS[index];

    const text = document.createElement("span");
    text.className = "choice-text";
    text.textContent = choice;

    button.append(marker, text);
    button.addEventListener("click", () => {
      state.answers[question.id] = choice;
      highlightChoice(area, choice);
    });

    area.appendChild(button);
  });
}

function highlightChoice(container, selectedChoice) {
  container.querySelectorAll(".choice-btn").forEach(button => {
    const isSelected = button.dataset.choice === selectedChoice;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function restoreAnswer(question) {
  const answer = state.answers[question.id];

  if (answer !== undefined) {
    highlightChoice(document.getElementById("answer-area"), answer);
  }
}

function handleQuizKeydown(event) {
  const quizScreen = document.getElementById("screen-quiz");

  if (quizScreen.hidden || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const keyIndex = CHOICE_MARKERS.indexOf(event.key);

  if (keyIndex !== -1) {
    const buttons = document.querySelectorAll("#answer-area .choice-btn");

    if (buttons[keyIndex]) {
      buttons[keyIndex].click();
      event.preventDefault();
    }
    return;
  }

  if (event.key === "Enter" && document.activeElement.tagName !== "BUTTON") {
    nextQuestion();
    event.preventDefault();
  }
}

function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  showResult();
}

// =======================
// 採点と結果表示
// =======================
function normalize(value) {
  return String(value ?? "").trim();
}

function judge(question, answer) {
  return normalize(answer) === normalize(question.correct);
}

function showResult() {
  showScreen("screen-result");

  let correctCount = 0;
  let unansweredCount = 0;
  const list = document.getElementById("result-list");
  list.innerHTML = "";

  const outcomes = state.questions.map((question, index) => {
    const answer = state.answers[question.id];
    const isUnanswered = answer === undefined;
    const isCorrect = !isUnanswered && judge(question, answer);

    if (isCorrect) {
      correctCount += 1;
    }
    if (isUnanswered) {
      unansweredCount += 1;
    }

    return {
      question,
      answer,
      isUnanswered,
      isCorrect,
      index
    };
  });

  if (!state.progressCommitted) {
    const transitions = {};

    outcomes.forEach(({ question, isUnanswered, isCorrect }) => {
      if (!isUnanswered) {
        transitions[question.id] = updateQuestionProgress(question.id, isCorrect);
      }
    });

    state.progressTransitions = transitions;
    state.progressCommitted = true;
    saveProgress();
  }

  outcomes.forEach(({ question, answer, isCorrect, isUnanswered, index }) => {
    list.appendChild(
      createResultItem(
        question,
        answer,
        isCorrect,
        isUnanswered,
        index,
        state.progressTransitions[question.id]
      )
    );
  });

  const total = state.questions.length;
  const percent = Math.round((correctCount / total) * 100);
  const score = document.getElementById("score");
  score.innerHTML = "";

  const scoreNumber = document.createElement("span");
  scoreNumber.className = "score-num";
  scoreNumber.textContent = String(correctCount);
  score.append("正解 ", scoreNumber, ` / ${total}`);

  document.getElementById("score-percent").textContent = `正答率 ${percent}%`;
  document.getElementById("score-sub").textContent =
    `${state.lastSettings.profileLabel}配分・未回答 ${unansweredCount}問`;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createResultItem(question, answer, isCorrect, isUnanswered, index, progressTransition) {
  const status = isUnanswered
    ? "unanswered"
    : isCorrect
      ? "correct"
      : "incorrect";

  const item = document.createElement("li");
  item.className = `result-item is-${status}`;

  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = status === "correct" ? "○" : status === "incorrect" ? "×" : "−";
  badge.setAttribute("role", "img");
  badge.setAttribute(
    "aria-label",
    status === "correct" ? "正解" : status === "incorrect" ? "不正解" : "未回答"
  );

  const body = document.createElement("div");
  body.className = "result-body";

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent =
    `Q${index + 1}　${question.period}・第${question.questionNumber}問・難易度 ${formatDifficulty(question.difficulty)}`;

  const text = document.createElement("p");
  text.className = "result-question";
  text.textContent = cleanQuestionText(question.question);

  const answers = document.createElement("dl");
  answers.className = "result-answers";
  answers.appendChild(createAnswerLine("正解", question.correct, "answer-correct"));

  if (question.correctReading) {
    answers.appendChild(createAnswerLine("読み", question.correctReading, "answer-reading"));
  }

  answers.appendChild(
    createAnswerLine(
      "あなたの答え",
      isUnanswered ? "未回答" : answer,
      isCorrect ? "answer-correct" : isUnanswered ? "answer-unanswered" : "answer-wrong"
    )
  );

  body.append(meta, text, answers);

  if (progressTransition) {
    body.appendChild(createProgressTransition(progressTransition));
  }

  item.append(badge, body);
  return item;
}

function createProgressTransition(transition) {
  const row = document.createElement("div");
  row.className = "progress-transition";
  row.setAttribute("aria-label", `習得状況 ${transition.beforeLabel}から${transition.afterLabel}`);

  const before = document.createElement("span");
  before.className = `progress-tag is-${transition.before}`;
  before.textContent = transition.beforeLabel;

  const arrow = document.createElement("span");
  arrow.className = "progress-arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");

  const after = document.createElement("span");
  after.className = `progress-tag is-${transition.after}`;
  after.textContent = transition.afterLabel;

  row.append(before, arrow, after);
  return row;
}

function createAnswerLine(labelText, value, valueClass) {
  const line = document.createElement("div");
  const label = document.createElement("dt");
  const detail = document.createElement("dd");

  label.textContent = labelText;
  detail.textContent = value;
  detail.className = valueClass;
  line.append(label, detail);
  return line;
}

// =======================
// 習得状況
// =======================
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    const records =
      parsed && typeof parsed === "object" && parsed.records && typeof parsed.records === "object"
        ? parsed.records
        : {};

    return Object.fromEntries(
      Object.entries(records)
        .filter(([, value]) => Number.isInteger(value) && value >= 0 && value <= 3)
    );
  } catch (error) {
    console.warn("学習履歴を読み込めませんでした。新規状態で開始します。", error);
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        records: state.progress
      })
    );
  } catch (error) {
    console.warn("学習履歴を保存できませんでした。", error);
  }
}

function pruneProgress() {
  const validIds = new Set(state.allQuestions.map(question => question.id));
  let changed = false;

  Object.keys(state.progress).forEach(questionId => {
    if (!validIds.has(questionId)) {
      delete state.progress[questionId];
      changed = true;
    }
  });

  if (changed) {
    saveProgress();
  }
}

function progressValueToStatus(value) {
  if (value === 0) {
    return "miss";
  }
  if (value === 1) {
    return "hit";
  }
  if (value === 2) {
    return "double";
  }
  if (value >= 3) {
    return "triple";
  }
  return "new";
}

function getQuestionProgressStatus(questionId) {
  return progressValueToStatus(state.progress[questionId]);
}

function getProgressLabel(status) {
  return PROGRESS_STATUSES.find(item => item.id === status)?.label || status;
}

function countByProgressStatus(questions) {
  const counts = Object.fromEntries(
    PROGRESS_STATUSES.map(status => [status.id, 0])
  );

  questions.forEach(question => {
    counts[getQuestionProgressStatus(question.id)] += 1;
  });

  return counts;
}

function updateMasterySummary() {
  if (!state.isLoaded && state.allQuestions.length === 0) {
    return;
  }

  const counts = countByProgressStatus(state.allQuestions);
  const total = state.allQuestions.length;

  PROGRESS_STATUSES.forEach(status => {
    const output = document.getElementById(`mastery-count-${status.id}`);

    if (output) {
      output.textContent = counts[status.id].toLocaleString("ja-JP");
    }

    const segment = document.getElementById(`mastery-seg-${status.id}`);
    if (segment) {
      const percent = total > 0 ? (counts[status.id] / total) * 100 : 0;
      segment.style.width = `${percent}%`;
    }
  });

  const triplePercent = total > 0
    ? Math.round((counts.triple / total) * 100)
    : 0;

  const headline = document.getElementById("mastery-headline");
  if (headline) {
    headline.textContent =
      `トリプル ${counts.triple.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}　（${triplePercent}%）`;
  }

  const bar = document.getElementById("mastery-bar");
  if (bar) {
    bar.setAttribute("aria-valuenow", String(triplePercent));
    bar.setAttribute(
      "aria-valuetext",
      `全${total.toLocaleString("ja-JP")}問中、トリプル${counts.triple.toLocaleString("ja-JP")}問、` +
      `ダブル${counts.double.toLocaleString("ja-JP")}問、ヒット${counts.hit.toLocaleString("ja-JP")}問、` +
      `ミス${counts.miss.toLocaleString("ja-JP")}問、未出題${counts.new.toLocaleString("ja-JP")}問`
    );
  }
}

function updateStatusFilterCounts(scopePool) {
  const counts = countByProgressStatus(scopePool);

  PROGRESS_STATUSES.forEach(status => {
    const output = document.getElementById(`status-count-${status.id}`);

    if (output) {
      output.textContent = counts[status.id].toLocaleString("ja-JP");
    }
  });
}


function resetProgress() {
  const counts = countByProgressStatus(state.allQuestions);
  const learnedCount = state.allQuestions.length - counts.new;

  if (learnedCount === 0) {
    return;
  }

  const ok = window.confirm(
    `${learnedCount.toLocaleString("ja-JP")}問分の進捗をすべて消して、全問を未出題に戻します。よろしいですか。`
  );

  if (!ok) {
    return;
  }

  state.progress = {};
  state.progressCommitted = false;
  state.progressTransitions = {};
  saveProgress();
  updateMasterySummary();
  updateStartState();
}

function updateQuestionProgress(questionId, isCorrect) {
  const before = getQuestionProgressStatus(questionId);
  const current = state.progress[questionId];

  if (isCorrect) {
    state.progress[questionId] =
      Number.isInteger(current) && current >= 1
        ? Math.min(3, current + 1)
        : 1;
  } else {
    state.progress[questionId] = 0;
  }

  const after = getQuestionProgressStatus(questionId);

  return {
    before,
    after,
    beforeLabel: getProgressLabel(before),
    afterLabel: getProgressLabel(after)
  };
}

// =======================
// 共通
// =======================
function getPeriodIdByLabel(label) {
  return PERIODS.find(period => period.label === label)?.id || "";
}

function formatDifficulty(difficulty) {
  return DIFFICULTY_LABELS[difficulty] || difficulty;
}

function cleanQuestionText(text) {
  return String(text ?? "").replace(/^【受験日本史】\s*/, "");
}

function pad4(number) {
  return String(number).padStart(4, "0");
}

function showStartError(message) {
  const area = document.getElementById("start-error");
  area.textContent = message;
  area.hidden = false;
}

function clearStartError() {
  const area = document.getElementById("start-error");
  area.textContent = "";
  area.hidden = true;
}

function showScreen(id) {
  ["screen-start", "screen-quiz", "screen-result"].forEach(screenId => {
    document.getElementById(screenId).hidden = true;
  });

  document.getElementById(id).hidden = false;
}

function backToStart() {
  state.questions = [];
  state.answers = {};
  state.currentIndex = 0;
  state.progressCommitted = false;
  state.progressTransitions = {};

  showScreen("screen-start");
  updateMasterySummary();
  updateStartState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
