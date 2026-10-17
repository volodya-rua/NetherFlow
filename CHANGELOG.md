# Changelog

What changed in each NetherFlow release. The builds are on the [releases page](https://github.com/volodya-rua/NetherFlow/releases).

## 1.5.1: Better search, playlists you can arrange, and a booster that never clips

- **Search** works like the big music apps: All, Songs, Artists and Albums at the top, the top result beside the first
  four songs, and artists and albums in rows. The page is there in under a second, and an artist's full list fills in
  as you look. A song from the search starts without a second search of its own
- **Playlists:** find a song in one as you type; sort by title, artist, newest added or length; Edit order to drag songs
  (or move them with the arrow keys); and Add songs from the playlist itself. On a phone, a playlist's buttons sit across
  under its name
- **Songs start sooner:** about 0.7 s less wait on a first play, and the artist's own upload is preferred even when
  YouTube Music doesn't answer
- **Covers** in long lists load faster, and one that won't load is tried another way
- **Lyrics in sync on rap songs:** word-by-word timing that's out of line with the song is lined up again, and words with
  no timing follow the song's own pace
- **A volume booster up to 300%,** through a new limiter: loud, with no clipping, and the bass and treble as they were
- **360 sound** keeps the bass as it is and no longer muddies the low-mids
- **Play on** (computers): pick the speakers or headphones it plays on
- **Interface size** (Settings): everything larger or smaller, 80–150% on computers and 100–150% on phones
- **Beat on the screen edges:** four looks (Wave, Bars, Neon, Glow) and four sizes
- **Esc twice** (computers) goes to the home screen, as Back does on a phone
- **No more freezes** picking Redline: the 3D race runs on its own, and Extreme lyrics turn on without a pause
- No glow follows the cursor any more; Settings › Update always shows the version; lyrics not timed to the song are an
  even column to read; on phones the Cover view keeps the next line clear of the timeline

## 1.5.0: NetherFlow's own player, and a much smaller app

- **Sound tools** in the Equalizer panel: Crossfeed for headphones, Clarity, Loudness at low volume and Night mode, plus
  360 sound (Around and Orbit). A "Playing now" line says the format and quality of what's playing
- **Gapless albums:** the next track of the same album starts the moment this one ends
- **Shuffle:** a toggle next to Repeat, and a Shuffle button beside Play all on playlists, Liked songs, mixes, artists
  and albums. Every song plays once, Back goes to the one before, and podcasts and audiobooks stay in order
- **Radio** from any song or artist: songs like it, without end
- **A mix for the time of day** in Explore (Morning, Afternoon, Evening, Late night), from what you play at that time
- **Follow artists:** their new releases first in Explore, and a note when they're out
- **Mix with a friend:** your taste as a link. A friend's opens as a mix of you both, the songs you both love first
- **Android Auto:** liked songs, recent plays and playlists on the car's screen, and voice search. NetherFlow has to be
  open on the phone, and Android Auto lists apps from outside the Play Store only with its Unknown sources developer
  setting on
- **A 10-band equalizer**, two more 360 modes, a strength setting for headphone correction, and a softer volume booster
- **Romanized lyrics** (Settings): sing along in Latin letters, worked out on your device
- **Word-by-word lyrics for more songs**, from the open AMLL lyrics database too, and smooth even where the timing is
  uneven
- **Carry on where you left off:** the last song is there when the app opens, and Play picks it up at the same moment
- **A new cursor** on computers: a glowing arrow in the mood's colours, with a ring that glides after it

- **Songs start right away, and the next one's already there when you skip.** NetherFlow plays through its own player
  now, FlowStream, in place of a hidden YouTube player: every song in the best sound YouTube has (usually Opus; a few songs only exist as AAC), and no hidden
  video running down your battery
- **The music video behind the lyrics** (Extreme lyrics, on computers) is sized to your screen and drops to 30 fps on
  battery
- **Saving for offline goes through FlowStream too:** the same best sound, a song saved in about 2 seconds
- **A much smaller app:** NetherFlow no longer carries yt-dlp (or, on Android, a whole Python to run it): the phone
  app is about 7 MB instead of 41, the Windows one about 17 MB lighter
- **The songs you played last start instantly:** their first moments are kept on your device (Settings › Instant start,
  where you can also clear them)
- **The right version of a song:** a remix finds the remix, a live take the live one, and the artist's own upload is
  preferred. Imported playlists keep each song's version too
- **Lyrics show much sooner:** the synced lines appear as soon as they're found, and the word-by-word timing takes over
  when it arrives
- **A quicker start**, a cleaner Android splash screen, and backgrounds drawn without holding the app up
- **Smooth even on long playlists**, and the Redline races load without holding the app up
- **Imports:** every song of a playlist is in at once, ready to play; a playlist imported again opens straight away;
  long playlists read faster
- **Offline:** a song that isn't saved gives way to the next one that is, and says so. Offline saves carry on after the app
  closes, and resume when the internet comes back
- **Playlists you edit together** connect faster and stay connected
- YouTube Music's lyrics say who they come from
- A song that won't load is tried a few ways, then skipped with a note saying which, so the music doesn't stop
- When the lyrics site is busy, NetherFlow says so and tries again, rather than saying there are no lyrics
- The quality line shows each song's real bitrate

- **Every screen works with the remote.** Move songs in the queue (OK on a song's handle, then up and down), read the
  terms, and use the QR code, Rename and artist pages over the Library. Back always closes the screen on top
- **The TV home's title** no longer runs into the header
- **Easier on the eyes:** the lyric looks that flash do it at most twice a second, never when your system asks for less
  motion, and NetherFlow tells you the first time
- **Listen together and shared playlists go through NetherFlow's own relay now**: it keeps no logs and, as before, can't
  read anything (it's all end-to-end encrypted). The public relays stay as a backup for a while
- Heads-up: someone on 1.4.2 or older can't join a Listen together session started on 1.5.0, so update both sides.
  Shared playlists keep working with older versions
- The terms and privacy policy changed a little (which country's law applies, a note on flashing light, and the new
  relay), so you're asked to accept them again

**Fixes**

- A song liked, or a playlist opened from a link, in the first moments after the app starts is no longer lost
- The equalizer's top bands can be dragged again
- Mixes no longer list the same song twice
- Searching podcasts and audiobooks: a slow earlier search no longer replaces the results of a newer one
- Artist and album pages say when they couldn't load, rather than showing no songs
- The lyric video comes back by itself after the graphics card resets
- Stories, and the stats and playlist pictures, are made without freezing the phone
- Android: a cover that never arrives no longer holds the notification up, a podcast download stopped earlier no longer
  stops the next one, and the app no longer closes when the notification can't restart
- The update check tries again at the next start when it couldn't reach GitHub

## 1.4.2: Listen together and sync, locked down tighter

- **Codes nobody can work out.** Listen together codes are 9 characters now and phone ↔ PC sync codes 12 numbers, made so
  that someone watching the relay or your Wi-Fi would need years to guess them
- **Listen together finds your friends more reliably**: if a relay is flaky for one of you, NetherFlow tries the others,
  and nobody gets stuck paused on the first song
- Heads-up: 1.4.1 and 1.4.2 can't Listen together or sync with each other, so update both sides

## 1.4.1: Tactical got its own crew

- **Six agents of its own** in the Tactical theme: Vanta, Onyx, Kestrel, Solstice, Halcyon and Tempest, drawn by the app
  itself. Pick your favourite in Settings, or get a different one every song
- Nothing gets fetched from anywhere for the theme anymore

## 1.4: Podcasts, audiobooks, Explore, playlists you make together, Linux and your TV

- **Podcasts.** Shows from Apple's podcast directory, plus your country's top 50. Follow a show and its new episodes
  show up for you. It picks up where you left off, plays at 0.8× to 2×, and you can **save episodes for offline**
- **Audiobooks.** Thousands of free classics read by LibriVox's volunteers (Sherlock Holmes, Moby Dick, Jane Austen…),
  chapter by chapter, from where you stopped
- **Explore.** Your country's charts, fresh albums and singles, what's trending, and every mood and genre with its
  playlists. Plus **Your mix** and **Discover**, made from what you actually play (and Discover only has songs you haven't
  heard), and **New from artists you play**
- **Playlists you make together.** Hit *Edit together*, send the link, and everyone who opens it can add, remove and rename,
  live, on any phone or PC. No account, and it's end-to-end encrypted
- **Headphone correction.** Pick your headphones (6,000+ models, from AutoEQ) and the equalizer evens out their sound
- **Linux.** A .deb and an AppImage, same app, same everything
- **Android TV and Google TV.** It's on your TV's home screen, and the whole app works with the remote: the arrows go from
  thing to thing, OK presses, Back goes back. Runs on 32-bit TV boxes too (Chromecast with Google TV, Fire TV…)
- **A new license: GPL v3.** Still free and open source. Changed versions have to stay open source too, keep the credit,
  and use a name and logo of their own ([details](#license)). 1.3.1 and earlier stay under MIT

## 1.3.1: Playlists of any length, and many fixes

- **Import as big as you want.** A 10,000-song Spotify playlist comes in whole. Short links too. Import the same one again
  later and it just adds what's new, no second copy
- **Taking a song out of the queue doesn't touch your playlist anymore** (it used to delete it from there)
- A song that won't load gets retried, then skipped, and **Autoplay keeps the music going** even when YouTube hiccups
- Search in **Hindi, Arabic, Korean or Chinese** and you get the original, not the covers
- Fits **small laptops**, **phones sideways** and **big text sizes**, and works with just a **keyboard** (Tab, Space, Enter)

## 1.3: Share playlists with a QR code

<img src="docs/media/share.webp" width="300" align="right" alt="Sharing a playlist: its QR code, Copy link and Save QR">

Open any playlist and tap **Share** for its QR code. Your friend points their phone camera at it and sees the
whole playlist. Then they paste the link in NetherFlow's search and it's theirs. Or just send the link.

- **Nothing gets uploaded.** The songs ride inside the link itself, no server, no account
- **Save QR** makes a card with the code on it, ready for your story or the group chat
- Works for **Liked songs** too
- The QR code on the right is a real one: scan it

<br clear="right">

## 1.2: Redline's 3D races

<p align="center">
  <img src="docs/media/race.webp" width="100%" alt="Redline: a 3D night race on a real circuit, filmed like a broadcast">
</p>

- **Redline got real 3D races.** On famous circuits, built from real map data with the real hills, buildings,
  grandstands with crowds, barriers and forests. Five supercars race each other all on their own: braking for every
  corner, slipstreaming, overtaking side by side, one of them drifting in its own smoke. It's filmed like a TV
  broadcast and cut on the beat. In a build-up the start lights come on one by one, and when the chorus drops they go
  out and the whole field blasts under the gantry in slow-mo. Windows, on Extreme+
- **Music videos are smooth now.** Behind Extreme lyrics the song's official video plays straight through, in sync with
  the song. No more jumpy cuts
- **It never freezes.** As long as NetherFlow is on your screen it keeps moving, even with another window on top
- **NetherFlow Lite** for Windows, and **Settings › 3D race** with a *Load now* button
