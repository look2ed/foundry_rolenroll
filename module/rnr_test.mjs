// ===============================
// RolEnRoll Dice System Logic
// ===============================

// Keep value between min and max
function clamp(v, min, max) {
  v = Number(v ?? 0);
  if (Number.isNaN(v)) v = 0;
  return Math.max(min, Math.min(max, v));
}

// Build the 6 faces for a single die configuration.
// All dice start as: ["1", "", "", "", "", "R"]
// kind = "normal" | "adv" | "neg"
// adv: plusCount = 1..4   → "+" on that many blank faces
// neg: minusCount = 1..4  → "-" on that many blank faces
function buildDieFaces(config = {}) {
  const kind = config.kind ?? "normal";
  const faces = ["1", "", "", "", "", "R"]; // index 0..5 (die sides 1..6)

  if (kind === "adv") {
    const plusCount = clamp(config.plusCount ?? 1, 1, 4);
    for (let i = 0; i < plusCount; i++) {
      faces[1 + i] = "+"; // fill positions 2–5
    }
  } else if (kind === "neg") {
    const minusCount = clamp(config.minusCount ?? 1, 1, 4);
    for (let i = 0; i < minusCount; i++) {
      faces[1 + i] = "-"; // fill positions 2–5
    }
  }

  return faces;
}

// Convert numeric d6 result (1–6) to face label
function faceForRoll(config, value) {
  const faces = buildDieFaces(config);
  const index = clamp(value, 1, 6) - 1;
  return faces[index];
}

// Score faces using your rules:
// - "1" = 1 point
// - "R" = 1 point + 1 reroll
// - "+" / "-" only count if basePoints > 0
// - blank = 0
function scoreFaces(faces) {
  let basePoints = 0;
  let plusCount = 0;
  let minusCount = 0;
  let rerollCount = 0;

  for (const f of faces) {
    if (f === "1") {
      basePoints++;
    } else if (f === "R") {
      basePoints++;
      rerollCount++;
    } else if (f === "+") {
      plusCount++;
    } else if (f === "-") {
      minusCount++;
    }
  }

  let total = 0;
  if (basePoints > 0) {
    total = basePoints + plusCount - minusCount;
    if (total < 0) total = 0; // no negative totals
  }

  return { basePoints, plusCount, minusCount, rerollCount, total };
}

// Roll a pool of RolEnRoll dice with rerolls.
// dice = array of configs:
//   { kind: "normal" }
//   { kind: "adv", plusCount: 2 }
//   { kind: "neg", minusCount: 1 }
async function rollRolenrollPool({ actor = null, dice = [] } = {}) {
  // Default: 5 normal dice if nothing passed
  if (!Array.isArray(dice) || dice.length === 0) {
    dice = Array.from({ length: 5 }, () => ({ kind: "normal" }));
  }

  const allFaces = [];
  const allResults = [];

  let pending = dice.map(d => ({ ...d }));
  let safety = 0;

  // Each "R" creates another die of the same config
  while (pending.length > 0 && safety < 100) {
    safety++;
    const next = [];

    for (const conf of pending) {
  const roll = await (new Roll("1d6")).evaluate({ async: true });

  // 🔹 Tell Dice So Nice to show 3D dice
  if (game.dice3d) {
    // true = synchronize so everyone sees it
    game.dice3d.showForRoll(roll, game.user, true);
  }

  const value = roll.total;
  const face = faceForRoll(conf, value);

  allFaces.push(face);
  allResults.push({ config: conf, roll: value, face });

  if (face === "R") {
    next.push({ ...conf }); // reroll with same kind (normal/adv/neg)
  }
}


    pending = next;
  }

  const scoring = scoreFaces(allFaces);
const { basePoints, plusCount, minusCount, rerollCount, total } = scoring;

// build HTML squares for each die face
const diceHtml = allFaces.map(f => {
  let symbol = "&nbsp;";
  let extraClass = "";

  if (f === "1") {
    symbol = "●";            // 1 point = dot
    extraClass = "role-roll-face-point";
  } else if (f === "R") {
    symbol = "Ⓡ";            // reroll symbol
    extraClass = "role-roll-face-reroll";
  } else if (f === "+") {
    symbol = "+";            // advantage
    extraClass = "role-roll-face-plus";
  } else if (f === "-") {
    symbol = "−";            // negative
    extraClass = "role-roll-face-minus";
  } else {
    // blank
    extraClass = "role-roll-face-blank";
  }

  return `<span class="role-roll-die ${extraClass}">${symbol}</span>`;
}).join("");

const html = `
<div class="role-roll-chat">
  <div class="role-roll-header"><strong>Role&amp;Roll Dice Pool</strong></div>
  <div class="role-roll-dice-row">
    ${diceHtml}
  </div>
  <div>Base points: ${basePoints}</div>
  <div>+ tokens: ${plusCount}, - tokens: ${minusCount}</div>
  <div>R&R : ${rerollCount}</div>
  <div><strong>Total: ${total} point${total === 1 ? "" : "s"}</strong></div>
</div>`;


  const speaker = actor
    ? ChatMessage.getSpeaker({ actor })
    : ChatMessage.getSpeaker();

  await ChatMessage.create({
    user: game.user.id,
    speaker,
    content: html
  });

  return { faces: allFaces, results: allResults, scoring };
}

// Expose API
Hooks.once("init", () => {
  console.log("RolEnRoll | Initializing system & dice logic");
  game.rolenroll = game.rolenroll || {};
  game.rolenroll.rollPool = rollRolenrollPool;
});

// ----------------------------------------------------
// Chat command /rr
// Usage examples:
//   /rr           → 5 normal dice
//   /rr 3         → 3 normal dice
//   /rr 3 a4 n2   → 3 normal, 1 adv(+4), 1 neg(-2)
//   /rr a3 a1     → 1 adv(+3), 1 adv(+1)
// ----------------------------------------------------
Hooks.on("chatMessage", (chatLog, content, chatData) => {
  if (!content.startsWith("/rr")) return;

  const parts = content.trim().split(/\s+/);
  const args = parts.slice(1);

  let normalCount = 0;
  const dice = [];

  for (const arg of args) {
    // number → that many normal dice
    if (/^\d+$/.test(arg)) {
      normalCount += parseInt(arg, 10);
      continue;
    }

    // aX → one advantage die with X plus faces
    if (/^a\d+$/i.test(arg)) {
      const plusCount = parseInt(arg.slice(1), 10);
      dice.push({ kind: "adv", plusCount });
      continue;
    }

    // nX → one negative die with X minus faces
    if (/^n\d+$/i.test(arg)) {
      const minusCount = parseInt(arg.slice(1), 10);
      dice.push({ kind: "neg", minusCount });
      continue;
    }

    // unknown token → ignore
  }

  // If no args at all → default 5 normal dice
  if (normalCount === 0 && dice.length === 0) {
    normalCount = 5;
  }

  for (let i = 0; i < normalCount; i++) {
    dice.push({ kind: "normal" });
  }

  if (dice.length > 50) {
    ui.notifications.warn("RolEnRoll: Too many dice requested (max 50).");
    dice.length = 50;
  }

  const actor = game.user.character ?? null;
  game.rolenroll.rollPool({ actor, dice });

  return false; // stop normal chat handling
});

// ----------------------------------------------------
// RolEnRoll – Dice So Nice integration
// ----------------------------------------------------
Hooks.once("diceSoNiceReady", (dice3d) => {
  console.log("RolEnRoll | Registering custom d6 with Dice So Nice");

  dice3d.addSystem({
    id: "rolenroll_test",      // MUST match system.json "id"
    name: "RolEnRoll"
  });

  // Base RolEnRoll die: ["1", "", "", "", "", "R"]
  const baseLabels = ["1", "", "", "", "", "R"];

  dice3d.addDicePreset({
    type: "d6",
    system: "rolenroll_test",
    labels: baseLabels
  });
});
