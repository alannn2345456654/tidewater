# Change log

Notes about what we added to the game. These are not instructions, just so we remember.

## Basics
- The level has 3 sections of 18 columns. It is made with Phaser 3 and needs no build step.
- Each plug opens or closes its own drain. The pipes always pour water, but they only raise the level if every plug in their stretch is in.
- The walls are 36 px taller than the high water, so the water never goes over them. With high water you can climb a wall by floating next to it.
- The plug on the right side of the pit in section 2 starts already in, so the player does not have to jump the pit. You can change this with the letter `p` in `level.js`.

## Water (water.js)
- The water no longer has a fixed level. Each 20 px column has its own height, and the water flows from high to low.
- You can tune it with `QIN` (pipes), `QOUT` (drains), `G` (wave speed) and `DAMP` (friction).
- An open drain can't be plugged while a lot of water is running over it (`CLOSE_MAX_H`).
- After pulling a plug you have to wait a moment (`PLUG_LOCK`).

## Player
- Jump: `JUMP_V` went from -353 to -385 so there is more room to jump over the crab. We did not raise it more because the player still has to fit under the ceiling spikes.
- Health has 2 halves (`HP_MAX`). The crab takes half and everything else kills. After a hit there are 1.5 s without damage (`HURT_MS`).
- The player only swims if the water is at 35% or more (`SWIM_ENTER`) and stops swimming below 25% (`SWIM_EXIT`).
- If the player stands still in the water, they stand upright instead of swimming.
- The damage boxes follow the drawing. You can see them with the H key.

## Enemies
- Crab: walks on the ground, gets scared when the water reaches it, and raises its claws when you get close.
- Pelican: flies high. With high water it warns you and then dives.
- Shark: it is coded but turned off (`SHARK_ON = false`).
- When you die, the enemies go back to their start position.

## Cues and sound
- The ceiling spikes blink when the water is high, and a tick sounds when you get close.
- Sound and music are made with WebAudio, with no files. You can turn them down or off in Settings (M key).
- Touching a flag refills health and shows a flash.

## Style
- Dark drainage tunnel background, with a light around the player.
- The decoration has no collision: arches, grates, old pipes, algae, drips and cobwebs.

## Menus
- Title screen and level select. Right now only the Tutorial is available.
- Settings with music, effects, mute, hitboxes and timer.
- Works with keyboard, mouse and gamepad (Xbox or PlayStation).

## URL options (for the Activity 01 experiment)
- `?cues=inconsistent`: the hazards change color and shape. Without it, they are all red.
- `?warn=off`: no warning on the ceiling spikes.
- `?look=color`: original colors, without the dark style.
- `?sound=off`: no sound.
- `?debug=hitboxes`: shows the hitboxes.

## Data logging (optional)
If you fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of `game.js`, the events are sent to Supabase. If not, they are saved in `localStorage['tidewater_events']`.

Events: `session_start`, `plug_pull`, `death`, `hurt`, `gem`, `goal` and `rating`.

Supabase table:

    create table events (
      id bigint generated always as identity primary key,
      created_at timestamptz default now(),
      session_id text, variant text, type text, data jsonb, t integer
    );
    alter table events enable row level security;
    create policy "anon insert" on events for insert to anon with check (true);

## Changes for Activity 03
- The level is now a text map in `level.js`.
- The physics constants are together at the top of `game.js`.
- We removed the text from the level: the "E" on the plugs (now it is a glowing ring), the checkpoint message and the level title.
- We added the optional timer in Settings.
- We added Vercel Speed Insights in `index.html`. It only loads when the game is hosted (not on localhost), and an ad blocker may block it without affecting the game. We also added an inline favicon so there is no `/favicon.ico` 404.
