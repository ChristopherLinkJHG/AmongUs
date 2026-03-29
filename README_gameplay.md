# Gameplay Reference (School Mode)

This document describes the current game loop and interactions.

## Round phases

- `lobby`: waiting for enough players
- `playing`: movement, tasks, catches, evidence reports
- `meeting`: discussion timer runs
- `voting`: players vote to remove a suspect
- `ended`: winner shown, restart available

## Roles

- `teacher`
  - can use elevator/teleport
  - can catch nearby alive students (`C`)
  - wins when only one student remains alive
- `student`
  - completes tasks (`F`)
  - can call meetings (`M`) by button or evidence
- `student_with_key`
  - same as student plus elevator/teleport access

## Tasks

Current task set:

- `clean_whiteboard`
- `open_windows`
- `organize_lab_equipment`
- `copy_homework`
- `sort_pencils`

Rules:

- only alive students can complete tasks
- tasks require being near the marker
- task progress is global (`taskCompleted / taskTotal`)
- students win when all tasks are done

## Meeting mechanics

A meeting can start when an alive player:

- stands near the emergency meeting button and presses `M`, or
- stands near unreported evidence and presses `M`

Meeting lifecycle:

1. `meeting` phase starts (discussion timer)
2. transitions to `voting` phase
3. each alive player can vote once
4. result is resolved

Voting rules:

- majority target is eliminated
- tie means nobody is eliminated
- `skip` is available

## Evidence system

When teacher catches a student:

- the student is marked out (`alive = false`)
- student is moved to the office zone
- an evidence item is dropped at catch location (`phone` or `backpack`)
- evidence can trigger a meeting if an alive player sees it and presses `M`
- reported evidence is marked as reported and no longer usable

## Office and spectator behavior

- office zone is visualized in the map (`Sekretariat`)
- eliminated players are rendered as semi-transparent with `[OUT]`
- eliminated local player enters spectator camera behavior (follows alive players)

## End and restart

Round ends when a win condition is met:

- students: all tasks complete or teacher eliminated
- teacher: only one student alive

Restart:

- in `ended` phase, press `R` or use `Neue Runde starten`
- server resets tasks, evidence, votes, alive states, and assigns roles again

## UI

The overlay provides:

- phase
- role
- task progress
- status line
- meeting/voting panel with timer
- voting list with buttons
- round end panel with restart button
