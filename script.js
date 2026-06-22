// =============================================================================
// 상수
// =============================================================================

const COLS = 10;
const ROWS = 20;
const BASE_DROP_INTERVAL = 500;
const MIN_DROP_INTERVAL = 120;
const SPEED_SCORE_STEP = 200;
const SPEED_INTERVAL_REDUCTION = 25;
const SCORE_PER_LINE = 100;
const SPAWN_ROW = -1;
const NEXT_QUEUE_SIZE = 3;
const ROTATE_GRACE_MS = 1200;
const PREVIEW_COLS = 4;
const PREVIEW_ROWS = 4;
const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"];

const PIECES = {
  I: {
    shape: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    color: "piece-i",
  },
  O: {
    shape: [
      [1, 1],
      [1, 1],
    ],
    color: "piece-o",
  },
  T: {
    shape: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "piece-t",
  },
  S: {
    shape: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    color: "piece-s",
  },
  Z: {
    shape: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    color: "piece-z",
  },
  J: {
    shape: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "piece-j",
  },
  L: {
    shape: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "piece-l",
  },
};

// =============================================================================
// DOM 참조
// =============================================================================

const boardElement = document.getElementById("board");
const scoreElement = document.getElementById("score");
const gameOverElement = document.getElementById("game-over");
const holdBoardElement = document.getElementById("hold-board");
const nextListElement = document.getElementById("next-list");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");

// =============================================================================
// 게임 상태
// =============================================================================

let score = 0;
let board = createEmptyBoard();
let currentPiece = null;
let nextQueue = [];
let heldType = null;
let canHold = true;
let dropTimerId = null;
let isPlaying = false;
let isGameOver = false;
let keyboardBound = false;
let isAdvancing = false;
let isGrounded = false;
let lastRotateTime = 0;

// =============================================================================
// 데이터
// =============================================================================

function createEmptyBoard() {
  return Array.from({ length: ROWS }, function () {
    return Array(COLS).fill(null);
  });
}

function randomPieceType() {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

function refillNextQueue() {
  while (nextQueue.length < NEXT_QUEUE_SIZE) {
    nextQueue.push(randomPieceType());
  }
}

/**
 * 지정한 타입의 테트로미노를 생성합니다.
 */
function createPiece(type) {
  const pieceDef = PIECES[type];
  const shapeWidth = pieceDef.shape[0].length;

  return {
    type: type,
    shape: pieceDef.shape.map(function (row) {
      return row.slice();
    }),
    color: pieceDef.color,
    row: SPAWN_ROW,
    col: Math.floor((COLS - shapeWidth) / 2),
  };
}

function takeNextPiece() {
  refillNextQueue();
  const type = nextQueue.shift();
  refillNextQueue();
  return createPiece(type);
}

function spawnPreviewPiece() {
  refillNextQueue();
  currentPiece = createPiece(nextQueue[0]);
}

/**
 * 조각 shape에서 채워진 셀마다 callback(boardRow, boardCol)을 호출합니다.
 */
function eachFilledCell(piece, rowOffset, colOffset, callback) {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) {
        continue;
      }

      callback(piece.row + r + rowOffset, piece.col + c + colOffset);
    }
  }
}

// =============================================================================
// 규칙 (충돌 · 이동 · 점수 · 고정)
// =============================================================================

function canMove(piece, dx, dy, matrix) {
  let movable = true;

  eachFilledCell(piece, dy, dx, function (boardRow, boardCol) {
    if (!movable) {
      return;
    }

    if (boardCol < 0 || boardCol >= COLS || boardRow >= ROWS) {
      movable = false;
      return;
    }

    if (boardRow < 0) {
      return;
    }

    if (matrix[boardRow][boardCol] !== null) {
      movable = false;
    }
  });

  return movable;
}

function rotateShape(shape) {
  const rows = shape.length;
  const cols = shape[0].length;
  const rotated = [];

  for (let c = 0; c < cols; c++) {
    const newRow = [];
    for (let r = rows - 1; r >= 0; r--) {
      newRow.push(shape[r][c]);
    }
    rotated.push(newRow);
  }

  return rotated;
}

function resetGroundedState() {
  isGrounded = false;
}

function isInRotateGrace() {
  return Date.now() - lastRotateTime < ROTATE_GRACE_MS;
}

function movePiece(dx, dy) {
  if (!currentPiece || !isPlaying) {
    return false;
  }

  if (!canMove(currentPiece, dx, dy, board)) {
    return false;
  }

  currentPiece.col += dx;
  currentPiece.row += dy;

  if (dx !== 0) {
    resetGroundedState();
  }

  return true;
}

function rotatePiece() {
  if (!currentPiece || !isPlaying) {
    return false;
  }

  const previousShape = currentPiece.shape;
  currentPiece.shape = rotateShape(previousShape);

  if (!canMove(currentPiece, 0, 0, board)) {
    currentPiece.shape = previousShape;
    return false;
  }

  lastRotateTime = Date.now();
  resetGroundedState();
  return true;
}

function holdPiece() {
  if (!canHold || !currentPiece || !isPlaying) {
    return false;
  }

  canHold = false;
  const currentType = currentPiece.type;

  if (heldType === null) {
    heldType = currentType;
    currentPiece = takeNextPiece();
  } else {
    const swapType = heldType;
    heldType = currentType;
    currentPiece = createPiece(swapType);
  }

  resetGroundedState();
  updatePreviewPanels();

  if (getPiecePlacementIssues(currentPiece).hasBlocked) {
    currentPiece = null;
    setGameOver();
    updatePreviewPanels();
    return false;
  }

  return true;
}

function isRowFull(row) {
  for (let col = 0; col < COLS; col++) {
    if (row[col] === null || row[col] === undefined) {
      return false;
    }
  }

  return true;
}

function clearLines() {
  let linesCleared = 0;
  const remaining = [];

  for (let row = 0; row < ROWS; row++) {
    if (isRowFull(board[row])) {
      linesCleared += 1;
    } else {
      remaining.push(board[row]);
    }
  }

  while (remaining.length < ROWS) {
    remaining.unshift(Array(COLS).fill(null));
  }

  board = remaining;
  return linesCleared;
}

function getDropInterval() {
  const reduction =
    Math.floor(score / SPEED_SCORE_STEP) * SPEED_INTERVAL_REDUCTION;
  return Math.max(MIN_DROP_INTERVAL, BASE_DROP_INTERVAL - reduction);
}

function addScore(linesCleared) {
  if (linesCleared <= 0) {
    return;
  }

  score += linesCleared * SCORE_PER_LINE;
  updateScoreDisplay();
  updateDropSpeed();
}

/**
 * 조각 배치 시 문제(천장 넘침·겹침·범위 밖)를 검사합니다.
 */
function getPiecePlacementIssues(piece) {
  let hasOverflow = false;
  let hasBlocked = false;

  eachFilledCell(piece, 0, 0, function (boardRow, boardCol) {
    if (boardRow < 0) {
      hasOverflow = true;
      return;
    }

    if (boardCol < 0 || boardCol >= COLS || boardRow >= ROWS) {
      hasBlocked = true;
      return;
    }

    if (board[boardRow][boardCol] !== null) {
      hasBlocked = true;
    }
  });

  return { hasOverflow: hasOverflow, hasBlocked: hasBlocked };
}

function lockPiece() {
  if (!currentPiece) {
    return { hasOverflow: false, hasBlocked: false };
  }

  const piece = currentPiece;
  const issues = getPiecePlacementIssues(piece);

  if (!issues.hasBlocked) {
    eachFilledCell(piece, 0, 0, function (boardRow, boardCol) {
      if (
        boardRow >= 0 &&
        boardRow < ROWS &&
        boardCol >= 0 &&
        boardCol < COLS
      ) {
        board[boardRow][boardCol] = piece.color;
      }
    });
  }

  return issues;
}

function spawnPiece() {
  currentPiece = takeNextPiece();
  canHold = true;
  resetGroundedState();
  lastRotateTime = 0;
  updatePreviewPanels();

  if (getPiecePlacementIssues(currentPiece).hasBlocked) {
    currentPiece = null;
    setGameOver();
    return false;
  }

  return true;
}

function lockAndAdvance() {
  if (isAdvancing || !currentPiece) {
    return;
  }

  isAdvancing = true;

  const issues = lockPiece();

  if (issues.hasOverflow || issues.hasBlocked) {
    currentPiece = null;
    setGameOver();
    isAdvancing = false;
    updatePreviewPanels();
    return;
  }

  const linesCleared = clearLines();
  addScore(linesCleared);
  spawnPiece();
  isAdvancing = false;
}

function tryGroundLock() {
  if (!currentPiece || !isPlaying) {
    return;
  }

  if (isInRotateGrace()) {
    isGrounded = true;
    return;
  }

  lockAndAdvance();
  isGrounded = false;
}

function moveDown() {
  if (!currentPiece || !isPlaying) {
    return;
  }

  if (movePiece(0, 1)) {
    return;
  }

  tryGroundLock();
}

function hardDrop() {
  if (!currentPiece || !isPlaying) {
    return;
  }

  while (canMove(currentPiece, 0, 1, board)) {
    currentPiece.row += 1;
  }

  isGrounded = false;
  lastRotateTime = 0;
  lockAndAdvance();
}

function getGhostPiece() {
  if (!currentPiece) {
    return null;
  }

  const ghost = {
    type: currentPiece.type,
    shape: currentPiece.shape.map(function (row) {
      return row.slice();
    }),
    color: currentPiece.color,
    row: currentPiece.row,
    col: currentPiece.col,
    isGhost: true,
  };

  while (canMove(ghost, 0, 1, board)) {
    ghost.row += 1;
  }

  return ghost;
}

// =============================================================================
// 렌더링
// =============================================================================

function drawPieceOnto(display, piece, asGhost) {
  if (!piece) {
    return display;
  }

  eachFilledCell(piece, 0, 0, function (boardRow, boardCol) {
    if (
      boardRow >= 0 &&
      boardRow < ROWS &&
      boardCol >= 0 &&
      boardCol < COLS
    ) {
      const cellValue = asGhost ? piece.color + " ghost" : piece.color;
      if (!asGhost || display[boardRow][boardCol] === null) {
        display[boardRow][boardCol] = cellValue;
      }
    }
  });

  return display;
}

function setCellClass(cell, value) {
  if (!value) {
    cell.className = "cell";
    return;
  }

  const parts = value.split(" ");
  if (parts.length === 2 && parts[1] === "ghost") {
    cell.className = "cell ghost " + parts[0];
    return;
  }

  cell.className = "cell " + value;
}

function renderBoard(boardState) {
  const cells = boardElement.children;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      setCellClass(cells[index], boardState[row][col]);
    }
  }
}

function getDisplayBoard() {
  let display = board.map(function (row) {
    return row.slice();
  });

  const ghost = getGhostPiece();
  display = drawPieceOnto(display, ghost, true);
  display = drawPieceOnto(display, currentPiece, false);

  return display;
}

function refreshDisplay() {
  renderBoard(getDisplayBoard());
}

function renderMiniBoard(container, type) {
  container.innerHTML = "";

  for (let i = 0; i < PREVIEW_ROWS * PREVIEW_COLS; i++) {
    const cell = document.createElement("div");
    cell.className = "mini-cell";
    container.appendChild(cell);
  }

  if (!type) {
    return;
  }

  const piece = createPiece(type);
  const offsetRow = Math.floor((PREVIEW_ROWS - piece.shape.length) / 2);
  const offsetCol = Math.floor((PREVIEW_COLS - piece.shape[0].length) / 2);
  const cells = container.children;

  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) {
        continue;
      }

      const index = (offsetRow + r) * PREVIEW_COLS + (offsetCol + c);
      cells[index].className = "mini-cell " + piece.color;
    }
  }
}

function updatePreviewPanels() {
  renderMiniBoard(holdBoardElement, heldType);

  nextListElement.innerHTML = "";

  for (let i = 0; i < NEXT_QUEUE_SIZE; i++) {
    const miniBoard = document.createElement("div");
    miniBoard.className = "mini-board";
    nextListElement.appendChild(miniBoard);
    renderMiniBoard(miniBoard, nextQueue[i] || null);
  }
}

function initBoardElement() {
  boardElement.innerHTML = "";

  for (let i = 0; i < ROWS * COLS; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    boardElement.appendChild(cell);
  }
}

function initPreviewElements() {
  renderMiniBoard(holdBoardElement, null);
  updatePreviewPanels();
}

function updateScoreDisplay() {
  scoreElement.textContent = String(score);
}

function showGameOver() {
  gameOverElement.hidden = false;
}

function hideGameOver() {
  gameOverElement.hidden = true;
}

// =============================================================================
// 게임 루프
// =============================================================================

function tick() {
  if (!isPlaying) {
    return;
  }

  if (isGrounded) {
    tryGroundLock();
  } else {
    moveDown();
  }

  refreshDisplay();
}

function startDropTimer() {
  stopDropTimer();
  dropTimerId = setInterval(tick, getDropInterval());
}

function stopDropTimer() {
  if (dropTimerId !== null) {
    clearInterval(dropTimerId);
    dropTimerId = null;
  }
}

function updateDropSpeed() {
  if (isPlaying && dropTimerId !== null) {
    startDropTimer();
  }
}

function setGameOver() {
  isPlaying = false;
  isGameOver = true;
  isGrounded = false;
  stopDropTimer();
  showGameOver();
}

function resetGame() {
  stopDropTimer();
  isPlaying = false;
  isGameOver = false;
  isAdvancing = false;
  isGrounded = false;
  lastRotateTime = 0;
  score = 0;
  board = createEmptyBoard();
  nextQueue = [];
  heldType = null;
  canHold = true;
  refillNextQueue();
  spawnPreviewPiece();
  hideGameOver();
  updateScoreDisplay();
  updatePreviewPanels();
  refreshDisplay();
}

function startGame() {
  resetGame();
  isPlaying = true;
  currentPiece = takeNextPiece();
  canHold = true;
  resetGroundedState();
  updatePreviewPanels();
  refreshDisplay();
  startDropTimer();
}

function restartGame() {
  startGame();
}

// =============================================================================
// 입력
// =============================================================================

function applyInputAction(action, alwaysRefresh) {
  const result = action();

  if (alwaysRefresh || result) {
    refreshDisplay();
  }
}

function handleKeyDown(event) {
  if (!isPlaying || !currentPiece || isGameOver) {
    return;
  }

  switch (event.code) {
    case "ArrowLeft":
      event.preventDefault();
      applyInputAction(function () {
        return movePiece(-1, 0);
      });
      break;
    case "ArrowRight":
      event.preventDefault();
      applyInputAction(function () {
        return movePiece(1, 0);
      });
      break;
    case "ArrowDown":
      event.preventDefault();
      applyInputAction(function () {
        moveDown();
      }, true);
      break;
    case "ArrowUp":
      event.preventDefault();
      applyInputAction(function () {
        return rotatePiece();
      });
      break;
    case "Space":
      event.preventDefault();
      applyInputAction(function () {
        hardDrop();
      }, true);
      break;
    case "ShiftLeft":
    case "ShiftRight":
      event.preventDefault();
      applyInputAction(function () {
        return holdPiece();
      });
      break;
    default:
      break;
  }
}

function bindKeyboard() {
  if (keyboardBound) {
    return;
  }

  document.addEventListener("keydown", handleKeyDown);
  keyboardBound = true;
}

// =============================================================================
// 초기화
// =============================================================================

startBtn.addEventListener("click", function () {
  startGame();
});

restartBtn.addEventListener("click", function () {
  restartGame();
});

initBoardElement();
initPreviewElements();
bindKeyboard();
refillNextQueue();
spawnPreviewPiece();
refreshDisplay();
updateScoreDisplay();
