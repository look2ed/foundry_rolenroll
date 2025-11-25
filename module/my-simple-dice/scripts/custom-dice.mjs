// ===============================
// RolEnRoll Dice System Logic
// ===============================

// Helper to keep values in a safe range
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
  const faces = ["1", "", "", "", "", "R"]; // index 0..5  (1..6 on the die)

  if (kind === "adv") {
    const plusCount = clamp(config.plusCount ?? 1, 1, 4);
    for (let i = 0; i < plusCount; i++) {
      // Fill positions 2,3,4,5 (indexes 1..4) with "+"
      faces[1 + i] = "+";
    }
  } else if (kind === "neg") {
    const minusCount = clamp(config.minusCount ?? 1, 1, 4);
    for (let i = 0; i < minusCount; i++) {
      faces[1 + i] = "-";
    }
  }

  return faces;
}

// Given a die config and a numeric d6 roll (1–6), return the face label.
function faceForRoll(config, value) {
  const faces = buildDieFaces(config);
  const index = clamp(value, 1, 6) - 1; // convert 1..6 → 0..5
  return faces[index];
}

// Score a list of faces according to your rules:
// - "1" = 1 point
// - "R" = 1 point and 1 reroll
// - "+" / "-" only count if there is at least 1 base point
// - blank = 0
function scoreFaces(faces) {
  let basePoints = 0;
  let plusCount = 0;
  let minusCount = 0;
  let rerollCount = 0;

  for (const f of faces) {
    if (f === "1") {
      basePoints += 1;
    } else if (f === "R") {
      basePoints += 1;
      rerollCount += 1;
    } else if (f === "+") {
      plusCount += 1;
    } else if (f === "-") {
      minusCount += 1;
    }
  }

  let total = 0;
  if (basePoints > 0) {
    total = basePoints + plusCount - minusCount;
    if (total < 0) total = 0; // optional safeguard: don't go below 0
  }

  return { basePoints, plusCount, minusCount, rerollCount, total };
}

// Main function: roll a pool of RolEnRoll dice with rerolls.
// - actor: optional Actor (for chat speaker)
// - dice: array of die configs, e.g.
//   { kind: "normal" }
//   { kind: "adv", plusCount: 2 }
//   { kind: "neg", minusCount: 1 }
async function rollRolenrollPool({ actor = null, dice = [] } = {}) {
  // If no dice passed, default to 5 normal dice
  if (!Array.isArray(dice) || dice.length === 0) {
    dice = Array.from({ length: 5 }, () => ({ kind: "normal" }));
  }

  const allFaces = [];
  const allResults = []; // to keep detailed info if you need it later

  // Start with initial dice
  let pending = dice.map(d => ({ ...d }));
  let safety = 0;

  // Process rerolls: each "R" generates a new die of the SAME config.
  // If you want rerolls to always be normal dice, replace `{ ...conf }` with `{ kind: "normal" }`.
  while (pending.length > 0 && safety < 100) {
    safety++;
    const next = [];

    for (const conf of pending) {
      const roll = await (new Roll("1d6")).evaluate({ async: true });
      const value = roll.total;
      const face = faceForRoll(conf, value);

      allFaces.push(face);
      allResults.push({ config: conf, roll: value, face });

      if (face === "R") {
        // Queue another die of the same type for reroll
        next.push({ ...conf });
      }
    }

    pending = next;
  }

  const scoring = scoreFaces(allFaces);

  // Render faces nicely for chat
  const faceSymbols = allFaces.map(f => {
    if (f === "") return "□";   // blank
    if (f === "1") return "①";  // point
    if (f === "R") return "Ⓡ";  // reroll
    if (f === "+") return "＋";
    if (f === "-") return "－";
    return f;
  }).join(" ");

  const { basePoints, plusCount, minusCount, rerollCount, total } = scoring;

  const html = `
<div class="rolenroll-chat">
  <div><strong>Role & Roll Dice</strong></div>
  <div>Faces: ${faceSymbols}</div>
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

// Make the function available as game.rolenroll.rollPool(...)
Hooks.once("init", () => {
  console.log("RolEnRoll | Initializing dice system");
  game.rolenroll = game.rolenroll || {};
  game.rolenroll.rollPool = rollRolenrollPool;
});


