Plan: School AmongUs Feature Roadmap
Build this as a staged vertical-slice rollout: first make one complete playable round loop (2-4 players), then expand content, German UI polish, and tooling/performance upgrades. This minimizes risk and gives a fast checkpoint before large refactors.

Recommended implementation order

Phase 1: Core game-state foundation
Add authoritative round concepts in state.ts: game phase (lobby, playing, meeting, voting, ended), role type, alive/out state, task progress state, meeting state, vote state.

Phase 1: Protocol contracts
Extend protocol.ts with typed messages for meeting call, vote submit, teacher catch, task interact/complete, and locale selection.
Dependency: Step 1.

Phase 1: Round bootstrap in room logic
Implement role assignment in WorldRoom.ts: exactly one teacher, one student with key, remaining normal students; spawn everyone in a large school lobby and initialize round state.
Dependency: Steps 1-2.

Phase 2: Teacher and elevator mechanics
In WorldRoom.ts and levels.ts, restrict elevator teleport usage to teacher and student with key; add teacher proximity catch with cooldown; move caught students to office and mark them out.

Phase 2: Task system and progress
Add school tasks as data + runtime instances: whiteboard, windows, lab equipment, homework, pencils.
Implement in state.ts, WorldRoom.ts, levels.ts, main.ts.
Task victory is global team progress for students.

Phase 2: Meeting and voting loop
Add lobby emergency button and meeting/voting flow in WorldRoom.ts and main.ts.
Rules: movement freeze during meeting/vote, majority eliminates, tie eliminates nobody.

Phase 2: Win-condition resolver
Evaluate after every state-changing event:
Teacher wins when only one student remains active.
Students win when all tasks complete or teacher is voted out.

Phase 3: German gameplay interface
Introduce lightweight i18n dictionary with German default and localize all player-facing text in main.ts, styles.css, and index.html overlays.

Phase 3: Professional game-only UI overlays
Keep world in Phaser, add minimal DOM overlay for lobby status, meeting panel, vote list, countdown, and result banner in index.html, main.ts, styles.css.

Phase 4: Tooling upgrades from your ideas
Add optional raster background metadata support (png, jpg, webp visual layer; collision stays JSON) and shape-agnostic marker parsing in svg-to-level.ts, with docs in README_svg.md.
This includes removing portal/task marker dependence on specific SVG element types.

Phase 4: Performance and decluttering pass
Profile and optimize backdrop/grid rendering and object visibility churn in main.ts, plus any high-frequency server checks in WorldRoom.ts.

Phase 5: 2-4 player balancing and hardening
Tune cooldowns, meeting timers, task counts, and handle leave/reconnect edge cases.

Additional feature ideas to include

Witness bonus for students: if a catch happens in near range of another student, auto-enable faster meeting trigger.
Office escape mini-chance: caught students can do one short timed action to reduce teacher advantage (configurable on/off).
Role briefing cards in German at round start: clear objectives, unique ability reminder, and win condition.
Task categories by room type (Klassenraum, Labor, Flur) to strengthen school theme and navigation.
Spectator ghost hints disabled by default for fairness in small lobbies.
Relevant files

state.ts
WorldRoom.ts
protocol.ts
levels.ts
main.ts
styles.css
index.html
svg-to-level.ts
README_svg.md
Verification plan

Type safety check across shared/server/client after each phase.
End-to-end 2-4 player playtest: role assignment, task completion, catch flow, office out state.
Meeting/voting test: freeze movement, vote tally, tie behavior, elimination result.
Win condition tests for all three outcomes: teacher win, student tasks win, teacher voted out.
Elevator permission test: only teacher and student with key can teleport.
German localization audit: no remaining English gameplay strings in active UI.
Tooling regression: old SVG conversion still works, new marker/background modes behave correctly.
Performance smoke benchmark before/after optimization pass.
Best point to start implementing

Start in state.ts with game phase, role, alive status, task, meeting, and vote schemas.
Immediately update protocol.ts to keep contracts synchronized.
Then implement one vertical slice in WorldRoom.ts: role assignment + one task + meeting call + one vote resolution.
After that slice is stable, scale to all tasks and full UI.
Plan has been saved to session memory and is ready for handoff if you approve.