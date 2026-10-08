# Pokémon Yutnori 🎲 (English)

A family board game where **Pokémon are the pieces** on a Korean *yut-nori* board — the English version of
[포켓몬 윷놀이](https://github.com/ian939/pokemon-yut). Made for a Korean first-grader learning English: every
screen is in simple English, and the game **speaks English** with natural recorded voices (Microsoft Edge TTS).

**▶ Play: https://ian939.github.io/pokemon-yut-en/**

## How to play

1. Pick **👨‍👩‍👧 Family Game**, **😈 vs Team Rocket**, or **🏠 Friend Battle** (2–4 pieces, Back-do on/off, ✨ Moves on/off).
2. Each team picks Pokémon — 27 starter Pokémon plus every Pokémon you catch in the ❓ tall grass.
3. **Throw!** the yut sticks:

   | Do | Gae | Geol | Yut | Mo | Back-do |
   | --- | --- | --- | --- | --- | --- |
   | 🐷 1 space | 🐶 2 spaces | 🐑 3 spaces | 🐮 4 spaces + throw again | 🐴 5 spaces + throw again | back 1 |

4. Tap a piece, then tap the glowing space to move.
5. Land on an enemy piece to battle — it runs back home and you throw again. Land on your own piece to stack.
6. Get all your pieces home first to win! 🏆

Extras: Pokémon **evolve** every 5 spaces and learn a **✨ move** at 10 spaces · ❓ tall grass with wild Pokémon and
Poké Balls · 🕐 clock quiz and 🏥 money quiz (Korean won) for bonus chances · 🪙 coin toss · 👤 profiles ·
💾 save codes · 🥇 ranking · 🏠 friend battles over the internet.

## Differences from the Korean version

- All text and speech are English. Speech uses clips pre-recorded with Edge TTS (`assets/voice/`); anything not
  recorded (names people type) falls back to the browser's voice.
- Saved data uses its own key (`engmon_yut_en_v1`). The first time it opens, it copies profiles, Pokémon and balls
  from the Korean version on the same device (not the game in progress, not save codes).
- Save codes, rankings and friend rooms use the same server as the Korean version.

## For developers

| Path | What |
| --- | --- |
| `index.html` | screens, animations, saving |
| `yut-rules.js` | rules engine (no DOM, tested with Node) |
| `data/pokemon.js` | Pokémon names (English), types, rarity, evolutions — `tools/extract-data.js` then `tools/english-data.js` |
| `assets/voice/` | Edge TTS clips + `voice.js` table — `python tools/gen-voice.py` |
| `docs/` | design notes (Korean, from the original project) |

```bash
node tools/test-rules.js          # rules tests
python tools/test-ui.py           # screen tests (Playwright)
python tools/audit-ui.py          # layout audit (clipping at 8 screen sizes)
python tools/gen-voice.py         # record new spoken lines (run after changing any TTS.say text)
```

## Credits

- Personal, non-commercial fan project.
- Pokémon images from [PokeAPI sprites](https://github.com/PokeAPI/sprites), cries from
  [PokeAPI cries](https://github.com/PokeAPI/cries), names from [PokeAPI](https://pokeapi.co/). Pokémon © Nintendo /
  Creatures Inc. / GAME FREAK inc.
- Board, sticks, mat and backgrounds were made with image generation for this project.
- Voice: Microsoft Edge text-to-speech (en-US-AnaNeural, en-US-GuyNeural).
- Font: [Galmuri](https://github.com/quiple/galmuri) © Minseo Lee — SIL Open Font License 1.1 (`assets/fonts/OFL.md`).
