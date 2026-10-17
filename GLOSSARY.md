# Mnemosyne

A lean-back viewer for personal camcorder footage: viewers land on a Channel and watch whatever is currently airing, the same for everyone, like broadcast TV.

## Language

**Clip**:
One continuous piece of recorded footage; the unit that gets scheduled and aired.
_Avoid_: Video, file, tape

**Original**:
A Clip's file exactly as it came off the camcorder; the source of truth for its footage and Recording time.
_Avoid_: Raw, source file, master

**Recording time**:
The camcorder-clock date and time at which a Clip began recording, as the camera understood it.
_Avoid_: Creation date, timestamp, date

**Date stamp**:
The camcorder-style on-screen date and time shown over an airing Clip, advancing as the Clip plays.
_Avoid_: Overlay, caption, OSD

**Library**:
The full collection of Clips.
_Avoid_: Catalogue, collection

**Channel**:
A named set of Clips drawn from the Library, with its own Schedule (e.g. _All_, _Malta_).
_Avoid_: Playlist, category

**Schedule**:
The deterministic, time-derived order in which a Channel's Clips air, identical for every viewer at any given moment.
_Avoid_: Playlist, stream, queue

**Channel order**:
How a Channel arranges its Clips within each Cycle: _shuffled_ (a fresh shuffle every Cycle; the default) or _chronological_ (by Recording time, the same sequence every Cycle).
_Avoid_: Sort, sequence

**Channel Guide**:
The list of Channels a viewer opens to pick one to Tune in to; the picture is hidden and muted while it's open.
_Avoid_: Menu, channel list, EPG

**Cycle**:
One complete pass of a Schedule through every Clip in its Channel, each Clip airing exactly once, in the Channel's order.
_Avoid_: Loop, round

**Tune in**:
A viewer joining a Channel at whatever point its Schedule is currently at, rather than from the start of a Clip.
_Avoid_: Play, start

**Switch off**:
A viewer stopping watching; switching back on always Tunes in live, never resumes where they left off.
_Avoid_: Pause
