// ===============================
// Role&Roll Dice System Logic
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
    let plusCount = config.plusCount ?? 1;
    if (plusCount > 4) plusCount = 4;
    plusCount = clamp(plusCount, 1, 4);
    for (let i = 0; i < plusCount; i++) {
      faces[1 + i] = "+"; // positions 2–5
    }
  } else if (kind === "neg") {
    let minusCount = config.minusCount ?? 1;
    if (minusCount > 4) minusCount = 4;
    minusCount = clamp(minusCount, 1, 4);
    for (let i = 0; i < minusCount; i++) {
      faces[1 + i] = "-"; // positions 2–5
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

// Render a single die face as a small square HTML block
function faceToDieHtml(f) {
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
    extraClass = "role-roll-face-blank"; // blank
  }

  return `<span class="role-roll-die ${extraClass}">${symbol}</span>`;
}

// Score faces using the same rules as the web roller:
// - "1" = 1 point
// - "R" = 1 point + 1 reroll
// - "+" / "-" only affect score if basePoints > 0
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

// ----------------------------------------
// Interactive rolling with reroll dialog
// ----------------------------------------

// Internal: roll ONE round of dice, return { round, rerollConfigs }
async function _rollOneRound(actor, diceConfigs) {
  const thisRound = [];
  const rerollConfigs = [];

  for (const config of diceConfigs) {
    const roll = await (new Roll("1d6")).evaluate({ async: true });

    // Show 3D dice via Dice So Nice
    if (game.dice3d) {
      game.dice3d.showForRoll(roll, game.user, true);
    }

    const value = roll.total;
    const face = faceForRoll(config, value);

    thisRound.push({ config, roll: value, face });

    if (face === "R") {
      // same die config will be used in the next round
      rerollConfigs.push({ ...config });
    }
  }

  return { round: thisRound, rerollConfigs };
}

// Internal: finalize scoring & send chat message
async function _finalizeAndSend(actor, rounds, bonusSuccess, bonusPenalty) {
  const baseFaces = rounds[0] ? rounds[0].map(r => r.face) : [];
  const rerollFaces = rounds.slice(1).flat().map(r => r.face);
  const allFaces = baseFaces.concat(rerollFaces);

  const scoringBase = scoreFaces(allFaces);
  const diceTotal = scoringBase.total;

  const baseScore = baseFaces.reduce(
    (s, f) => s + ((f === "1" || f === "R") ? 1 : 0),
    0
  );
  const rerollPoints = rerollFaces.reduce(
    (s, f) => s + ((f === "1" || f === "R") ? 1 : 0),
    0
  );
  const plusTokens = allFaces.filter(f => f === "+").length;
  const minusTokens = allFaces.filter(f => f === "-").length;
  const rerollCount = allFaces.filter(f => f === "R").length;

  let success = Number.isFinite(+bonusSuccess) ? +bonusSuccess : 0;
  let penalty = Number.isFinite(+bonusPenalty) ? +bonusPenalty : 0;
  if (success < 0) success = 0;
  if (penalty < 0) penalty = 0;

  let finalTotal = diceTotal + success - penalty;
  if (finalTotal < 0) finalTotal = 0;

  // Build HTML rows
  let rowsHtml = "";
  rounds.forEach((round, idx) => {
    if (!round.length) return;
    const facesHtml = round.map(r => faceToDieHtml(r.face)).join("");

    let label = "";
    if (idx === 0) {
      label = "";
    } else {
      label = `<em>(reroll ${idx})</em>&nbsp;`;
    }

    rowsHtml += `
  <div class="role-roll-dice-row">
    ${label}${facesHtml}
  </div>`;
  });

  const html = `
<div class="role-roll-chat">
  <div class="role-roll-header"><strong>Role&amp;Roll Dice Pool</strong></div>
  ${rowsHtml}
  <div>You triggered ${rerollCount} reroll${rerollCount === 1 ? "" : "s"}.</div>
  <div>Base from first roll (● + Ⓡ): ${baseScore}</div>
  <div>Extra points from rerolls: ${rerollPoints}</div>
  <div>Tokens: +${plusTokens} / -${minusTokens}</div>
  <div>Succ/Pen: +${success} / -${penalty}</div>
  <div class="role-roll-total">
    Dice total: ${diceTotal} point${diceTotal === 1 ? "" : "s"}<br/>
    Final total: ${finalTotal} point${finalTotal === 1 ? "" : "s"}
  </div>
</div>`;

  const speaker = actor
    ? ChatMessage.getSpeaker({ actor })
    : ChatMessage.getSpeaker();

  await ChatMessage.create({
    user: game.user.id,
    speaker,
    content: html
  });

  return {
    rounds,
    scoring: {
      ...scoringBase,
      baseScore,
      rerollPoints,
      plusTokens,
      minusTokens,
      rerollCount,
      success,
      penalty,
      diceTotal,
      finalTotal
    }
  };
}

// Recursive/interactive driver
async function _runInteractiveRoll({ actor, dice, bonusSuccess, bonusPenalty, rounds = [] }) {
  // 1. roll current round
  const { round, rerollConfigs } = await _rollOneRound(actor, dice);
  rounds.push(round);

  // 2. if no R faces, finalize immediately
  if (!rerollConfigs.length) {
    return _finalizeAndSend(actor, rounds, bonusSuccess, bonusPenalty);
  }

  const rerollCount = rerollConfigs.length;

  // 3. pop up dialog to confirm reroll
  const content = `
<p>You got <strong>${rerollCount}</strong> reroll${rerollCount === 1 ? "" : "s"}.</p>
<p>Press <strong>Reroll</strong> to roll those dice again with the same faces.</p>
`;

  new Dialog({
    title: "Role&Roll – Reroll",
    content,
    buttons: {
      reroll: {
        icon: '<i class="fas fa-dice"></i>',
        label: `Reroll ${rerollCount} dice`,
        callback: () => {
          // run next round with only the dice that had R
          _runInteractiveRoll({
            actor,
            dice: rerollConfigs,
            bonusSuccess,
            bonusPenalty,
            rounds
          });
        }
      },
      finish: {
        label: "Finish without reroll",
        callback: () => {
          _finalizeAndSend(actor, rounds, bonusSuccess, bonusPenalty);
        }
      }
    },
    default: "reroll"
  }).render(true);
}

// Public entry point
async function rollRolenrollPool({
  actor = null,
  dice = [],
  bonusSuccess = 0,
  bonusPenalty = 0
} = {}) {
  if (!Array.isArray(dice) || dice.length === 0) {
    dice = Array.from({ length: 5 }, () => ({ kind: "normal" }));
  }

  // Start the interactive chain
  return _runInteractiveRoll({ actor, dice, bonusSuccess, bonusPenalty, rounds: [] });
}

// ----------------------------------------
// Helpers to build dice from "tray" inputs
// ----------------------------------------
function parseSpecialTokens(specialText) {
  const specials = [];
  if (!specialText) return specials;

  const tokens = specialText.split(/[,\s]+/).filter(t => t.length);

  for (const tok of tokens) {
    if (/^a\d+$/i.test(tok)) {
      let plusCount = parseInt(tok.slice(1), 10);
      if (plusCount > 4) {
        ui.notifications.warn(
          "Role&Roll: Advantage die can have at most 4 + faces. Using 4 instead."
        );
        plusCount = 4;
      } else if (plusCount < 1) {
        ui.notifications.warn(
          "Role&Roll: Advantage die must have at least 1 + face. Using 1 instead."
        );
        plusCount = 1;
      }
      specials.push({ kind: "adv", plusCount });
      continue;
    }

    if (/^n\d+$/i.test(tok)) {
      let minusCount = parseInt(tok.slice(1), 10);
      if (minusCount > 4) {
        ui.notifications.warn(
          "Role&Roll: Negative die can have at most 4 - faces. Using 4 instead."
        );
        minusCount = 4;
      } else if (minusCount < 1) {
        ui.notifications.warn(
          "Role&Roll: Negative die must have at least 1 - face. Using 1 instead."
        );
        minusCount = 1;
      }
      specials.push({ kind: "neg", minusCount });
      continue;
    }

    ui.notifications.warn(`Role&Roll: Ignoring unknown special token "${tok}". Use aX or nX.`);
  }

  return specials;
}

function buildDiceFromTray(total, specialText) {
  let normalCount = 0;
  const specials = parseSpecialTokens(specialText);

  if (total > 0) {
    if (specials.length > total) {
      ui.notifications.warn(
        "Role&Roll: Number of special dice (a/n) cannot be more than Total dice."
      );
      return null;
    }
    normalCount = total - specials.length;
  } else {
    // no total given
    if (specials.length === 0) {
      normalCount = 5; // default
    } else {
      normalCount = 0;
    }
  }

  const dice = [];
  for (let i = 0; i < normalCount; i++) {
    dice.push({ kind: "normal" });
  }
  dice.push(...specials);

  if (!dice.length) {
    ui.notifications.warn("Role&Roll: No dice to roll.");
    return null;
  }

  if (dice.length > 50) {
    ui.notifications.warn("Role&Roll: Too many dice requested (max 50).");
    return null;
  }

  return dice;
}

// ----------------------------------------------------
// Init: expose API
// ----------------------------------------------------
Hooks.once("init", () => {
  console.log("Role&Roll | Initializing system & dice logic (interactive rerolls)");
  game.rolenroll = game.rolenroll || {};
  game.rolenroll.rollPool = rollRolenrollPool;
});

// ----------------------------------------------------
// Chat command /rr  (still works)
// ----------------------------------------------------
Hooks.on("chatMessage", (chatLog, content, chatData) => {
  if (!content.startsWith("/rr")) return;

  const parts = content.trim().split(/\s+/);
  const args = parts.slice(1);

  let totalDice = null;
  const specialsTokens = [];

  for (const arg of args) {
    if (/^\d+$/.test(arg)) {
      if (totalDice === null) {
        totalDice = parseInt(arg, 10);
      } else {
        ui.notifications.warn(
          "Role&Roll: Only the first number is used as the total dice count."
        );
      }
      continue;
    }
    specialsTokens.push(arg);
  }

  const specialText = specialsTokens.join(" ");
  const dice = buildDiceFromTray(totalDice ?? 0, specialText);
  if (!dice) return false;

  const actor = game.user.character ?? null;
  game.rolenroll.rollPool({ actor, dice });

  return false;
});

// ----------------------------------------------------
// Role&Roll Dice Tray injected into Chat sidebar
// ----------------------------------------------------
Hooks.on("renderChatLog", (app, html, data) => {
  // avoid duplicating the tray
  if (html.find("#role-roll-tray").length) return;

  const trayHtml = $(`
<div id="role-roll-tray" class="role-roll-tray">
  <div class="role-roll-tray-header"><strong>Role&Roll Dice Tray</strong></div>
  <div class="form-group">
    <label>Total:</label>
    <input type="number" name="rr-total" value="5" min="0" max="50"/>
  </div>
  <div class="form-group">
    <label>Special:</label>
    <input type="text" name="rr-special" placeholder="e.g. a1 a2 n1"/>
  </div>
  <div class="form-group">
    <label>Success:</label>
    <input type="number" name="rr-success" value="0" min="0"/>
  </div>
  <div class="form-group">
    <label>Penalty:</label>
    <input type="number" name="rr-penalty" value="0" min="0"/>
  </div>
  <div class="form-group">
    <button type="button" class="role-roll-tray-roll">
      <i class="fas fa-dice"></i> Roll
    </button>
  </div>
  <hr/>
</div>
`);

  // Insert tray above the chat input form
  const chatForm = html.find("#chat-form");
  if (chatForm.length) {
    trayHtml.insertBefore(chatForm);
  } else {
    html.append(trayHtml);
  }

  // Attach handler
  trayHtml.find(".role-roll-tray-roll").on("click", () => {
    const total = parseInt(trayHtml.find('input[name="rr-total"]').val(), 10) || 0;
    const specialText = String(trayHtml.find('input[name="rr-special"]').val() || "").trim();
    let success = parseInt(trayHtml.find('input[name="rr-success"]').val(), 10);
    let penalty = parseInt(trayHtml.find('input[name="rr-penalty"]').val(), 10);
    if (!Number.isFinite(success)) success = 0;
    if (!Number.isFinite(penalty)) penalty = 0;
    if (success < 0) success = 0;
    if (penalty < 0) penalty = 0;

    const dice = buildDiceFromTray(total, specialText);
    if (!dice) return;

    const actor = game.user.character ?? null;
    game.rolenroll.rollPool({
      actor,
      dice,
      bonusSuccess: success,
      bonusPenalty: penalty
    });
  });
});

// ----------------------------------------------------
// Role&Roll – Dice So Nice integration
// ----------------------------------------------------
Hooks.once("diceSoNiceReady", (dice3d) => {
  console.log("Role&Roll | Registering custom d6 with Dice So Nice");

  dice3d.addSystem({
    id: "rolenroll_test",      // MUST match system.json "id"
    name: "Role&Roll"
  });

  // Base Role&Roll die: ["1", "", "", "", "", "R"]
  const baseLabels = ["1", "", "", "", "", "R"];

  dice3d.addDicePreset({
    type: "d6",
    system: "rolenroll_test",
    labels: baseLabels
  });
});