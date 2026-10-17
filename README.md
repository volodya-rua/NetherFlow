<p align="center">
  <a href="https://volodya-rua.github.io/NetherFlow/"><img src="docs/media/hero.webp" width="100%" alt="NetherFlow: turn silence into song. Free and open source for Windows, Linux, Android and Android TV"></a>
</p>

<p align="center">
  A free, open-source music player for Windows, Linux, Android and Android TV.<br>
  Full songs, synced lyrics (word by word where the song has them), and backgrounds that move with the music. Podcasts and audiobooks too.<br>
  No account, no ads of its own, no analytics.
</p>

<p align="center">
  <a href="https://github.com/volodya-rua/NetherFlow/releases/latest"><b>Download</b></a> ·
  <a href="https://volodya-rua.github.io/NetherFlow/">Website</a> ·
  <a href="#features">Features</a> ·
  <a href="#compared-with-the-big-three">Comparison</a> ·
  <a href="#building-from-source">Building</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/volodya-rua/NetherFlow/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/volodya-rua/NetherFlow?style=flat-square&label=release&color=ff4a1c&labelColor=1a1210"></a>
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPL%20v3-f6ede4?style=flat-square&labelColor=1a1210"></a>
</p>

<p align="center">
  <img src="docs/media/pc.webp" width="100%" alt="NetherFlow on Windows: the home screen on Black Hole, Settings over Aurora, the equalizer over Liquid, and the themes and moods">
</p>

<a id="get-it"></a>

## Download

Every build is on the **[latest release](https://github.com/volodya-rua/NetherFlow/releases/latest)** page. NetherFlow is free.

| Platform | Installer | Portable |
|:--|:--|:--|
| **Windows Lite**<br><sub>Recommended</sub> | `NetherFlow-Lite-Setup-<version>.exe`<br><sub>Installs for you only (no admin), with shortcuts and an uninstaller, and updates itself</sub> | `NetherFlow-Lite-<version>-Windows.exe`<br><sub>Runs as it is, nothing to install</sub> |
| **Windows** | `NetherFlow-Setup-<version>.exe` | `NetherFlow-<version>-Windows.exe` |
| **Linux** (64-bit) | `NetherFlow-<version>-amd64.deb`<br><sub>Ubuntu, Debian, Mint, Pop!_OS and similar</sub> | `NetherFlow-<version>-x86_64.AppImage`<br><sub>Any distribution, and it updates itself. Ubuntu 24.04 and newer don't let it use Chromium's sandbox, so it runs without one; the .deb keeps it</sub> |
| **Android** 7.0+<br>**Android TV**, Google TV | `NetherFlow-<version>.apk` | <sub>The same app: on a TV it works with the remote</sub> |

On Windows and not sure which one? **Choose Lite.** It's the same app without Extreme+ (so no Redline races or cars, which
need a powerful graphics card anyway), about 18 MB smaller, and it updates to Lite.

<a id="whats-new"></a>

## What's new in 1.5.0

- **NetherFlow's own player, FlowStream**, in place of a hidden YouTube player. Songs start right away, the next one is
  ready when you skip, every song plays in the best sound YouTube has (usually Opus; a few songs only exist as AAC), and no hidden video drains the battery
- **Sound tools** in the Equalizer panel: Crossfeed for headphones, Clarity, Loudness at low volume and Night mode, plus
  360 sound (Around and Orbit). A "Playing now" line shows the format and quality of what's playing
- **Faster and steadier:** lyrics appear almost at once, word-by-word timing from more sources, a quicker start, a
  cleaner Android splash, and smooth even on long playlists
- **Discovery:** Radio from any song or artist, a mix for the time of day in Explore, Follow artists with a note when
  they release something, and Mix with a friend
- **Shuffle** for playlists, Liked songs, mixes, artists and albums, and **gapless albums**
- **Android Auto:** liked songs, recent plays and playlists on the car's screen, and voice search. NetherFlow has to be
  open on the phone, and Android Auto lists apps from outside the Play Store only with its Unknown sources developer
  setting on
- **Every screen works with the TV remote**, from the queue to the terms
- **Listen together and shared playlists go through NetherFlow's own relay**: it keeps no logs and, as before, can't
  read anything (it's all end-to-end encrypted). The public relays stay as a backup for a while
- **A much smaller app:** no more yt-dlp (or, on Android, a whole Python to run it). The phone app is about 7 MB instead
  of 41, the Windows one about 17 MB lighter

> [!NOTE]
> Someone on 1.4.2 or older can't join a Listen together session started on 1.5.0, so update both sides. Shared
> playlists keep working with older versions. The terms and privacy policy changed a little (which country's law
> applies, a note on flashing light, and the new relay), so you're asked to accept them again.

The full notes for this release and every earlier one are in the [changelog](CHANGELOG.md).

## Features

### Listening

- **Search anything** (songs, artists, albums) and play it in full. Typos get fixed and suggestions appear as you type
- **Autoplay**: when your list runs out it keeps going with songs like the one playing, in the same language and era,
  and it learns from what you skip, play through and like
- **Radio** from any song or artist, and **Shuffle** for any playlist, your liked songs, an artist or an album, every
  song once. A playlist still being imported shuffles in its new songs as they arrive
- **Smooth mix**: songs blend into each other like a DJ set, on the beat. Albums play **gapless**, straight from one song
  into the next
- **Explore**: charts, new releases, trending, moods and genres with their playlists, and **Your mix**, **Discover** and a
  mix for **the time of day** (morning, afternoon, evening, late night), made from what you play
- **Follow artists**: their new albums and singles show up first in Explore, and you hear when they're out
- **Podcasts and audiobooks**: follow shows, pick up where you left off, any speed from 0.8× to 2×
- **Equalizer** with presets, a volume booster, **headphone correction** for 6,000+ headphones (AutoEQ), and every song
  at its **original loudness**
- **Sound tools**: 360 sound, crossfeed for headphones, clarity, loudness at low volume and a night mode, and a line
  that shows the quality of what's playing
- **Save for offline**: one song, a whole playlist with *Download all*, or podcast episodes and audiobook chapters
- **Import playlists** of any length from Spotify, Apple Music or YouTube by pasting the link (Spotify's short links
  too). Even a 10,000-song playlist is there in seconds, ready to play, and it can keep itself in step with the original
  once a day
- **Your stats**: minutes, plays, streaks, top songs, artists and genres, and a card to share

### Lyrics

- **Synced lyrics**, word by word where the song has them, lined up to the exact recording that's playing, with **19 animations**: Wave, Spiral,
  Shatter, Fireworks, Swarm, Black Hole, Cylinder, Globe, Helix, DNA, Tornado, Knot, Möbius, Ribbon, Orbit, Atom,
  Tunnel, Cube and Classic
- **Extreme lyrics** (Windows): the lyrics cut like a music video or a lyric edit, every word landing as it's sung
  <details><summary>58 looks, emoji, and the music video behind it</summary>

  Chat bubbles, shattering glass, holographic foil, a slot machine, liquid filling the letters, label tape, grunge block
  letters, a typewriter, decoding, extruded 3D, Y2K chrome, neon signs, a turning cube, a split-flap board, graffiti, a
  ransom-note collage, karaoke, a strobe and more, with film scratches, glitches, glow and light leaks on the beat. Mixed
  (a new look every few words) or one look you pick. All 1,595 of Microsoft's 3D Fluent emoji appear by the words they
  fit ("fire", "moon", "dil"…). When the song has an official music video, it plays behind the words, smooth and
  straight through, in one colour grade for the song.
  </details>
- **Sing**: karaoke mode, with the voice turned down as far as you like and the lyrics large
- **13 font pairs** for the lyrics (Poster, Vogue, Neon, Arcade, Vinyl, Glitch, Graffiti, Cyber, Wide, Stencil, Bubble,
  Melt and Gothic)
- **Story clips**: a short video of the song with its lyrics, sized for an Instagram story

### With your people

- **Listen together**: up to 10 people hear the same song at the same moment, each on their own phone or PC. Anyone can
  add songs, skip and react. End-to-end encrypted, no account
- **Share playlists with a QR code**: tap Share on any playlist and a friend points their phone camera at it, or send
  the link and they paste it in NetherFlow's search. The songs ride inside the link itself; nothing is uploaded
- **Playlists you make together**: choose *Edit together*, send the link, and everyone with it can add, remove and
  rename, live. End-to-end encrypted, no account
- **Mix with a friend**: your taste and a friend's in one playlist. Send them your link; they open it
- **Phone ↔ PC sync**: liked songs, playlists, history and stats over your own Wi-Fi with a 12-number code
- **Discord status** (Windows): your song on your Discord profile, with its cover and progress

### On every screen

- **Windows**: a **now-playing island** at the top of the screen, over every app. Click it for the cover, timeline,
  volume and controls
- **Linux**: the same app as a .deb or an AppImage, with your song in your desktop's media controls
- **Android**: a home-screen widget, lyrics on the lock screen (and in the notification and on your car's display), and
  liked songs saving themselves for offline on Wi-Fi
- **Android Auto**: your liked songs, recently played and playlists on the car's screen, and voice search. NetherFlow
  plays from your phone, so open it there first. Android Auto shows apps from outside Google Play once its *Unknown
  sources* developer setting is on
- **Android TV and Google TV**: on the TV's home screen, and everything works with the remote
- **Updates inside the app**: the Windows installer downloads only what changed, and so does the Linux AppImage.
  NetherFlow's own Android app does the same, signed and checked first (a store's build is updated by the store). The
  portable app and the .deb don't update themselves
- Minimized or in the background, it draws nothing at all, so it's light on the battery

<p align="center">
  <img src="docs/media/phones.webp" width="100%" alt="NetherFlow on Android: the home screen on Smoke, the Spider theme, Settings, and the Blocks theme">
</p>

## Themes

One tap changes the whole app: every button, the colours, the fonts, the cursor, the timeline, the background, even how
the lyrics come in. There are six (five on Android).

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/media/themes/stickman.webp" alt="The Stickman theme"><br><b>Stickman</b><br><sub>Notebook paper and ink, with stick figures dancing to the beat</sub></td>
    <td width="33%" valign="top"><img src="docs/media/themes/spider.webp" alt="The Spider theme"><br><b>Spider</b><br><sub>A comic book at night, a masked hero swinging through the city, POW and WHAM on the beat</sub></td>
    <td width="33%" valign="top"><img src="docs/media/themes/blocks.webp" alt="The Blocks theme"><br><b>Blocks</b><br><sub>A blocky world at dusk to fly over, stone buttons and an XP bar</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/media/themes/tactical.webp" alt="The Tactical theme"><br><b>Tactical</b><br><sub>One of six agents of its own next to the lyrics, a round timer, ACE and CLUTCH banners</sub></td>
    <td width="33%" valign="top"><img src="docs/media/themes/ops.webp" alt="The Ops theme"><br><b>Ops</b><br><sub>A desert bomb site, smoke and tracers on the kick, the lyrics as a kill feed</sub></td>
    <td width="33%" valign="top"><img src="docs/media/themes/redline.webp" alt="The Redline theme"><br><b>Redline</b> <sub>· Windows, Extreme+</sub><br><sub>Real cars on real circuits in 3D, a rev counter round the play button</sub></td>
  </tr>
</table>

## Backgrounds

There are 27, and they take their colours from the album cover: smoke, northern lights, liquid colour, starfields,
galaxies, kaleidoscopes, fractals and more. A few of them:

<table>
  <tr>
    <td width="33%"><img src="docs/media/backgrounds/smoke.webp" alt="Smoke"><br><b>Smoke</b></td>
    <td width="33%"><img src="docs/media/backgrounds/aurora.webp" alt="Aurora"><br><b>Aurora</b></td>
    <td width="33%"><img src="docs/media/backgrounds/liquid.webp" alt="Liquid"><br><b>Liquid</b></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/media/backgrounds/cosmos.webp" alt="Cosmos"><br><b>Cosmos</b></td>
    <td width="33%"><img src="docs/media/backgrounds/galaxy.webp" alt="Galaxy"><br><b>Galaxy</b></td>
    <td width="33%"><img src="docs/media/backgrounds/kaleido.webp" alt="Kaleido"><br><b>Kaleido</b></td>
  </tr>
</table>

Quality goes from Low to Ultra, and on Windows there are **Extreme** and **Extreme+** for powerful graphics cards. On a
slower phone it steps down by itself, so it never lags. The look also includes **46 moods**, **12 timeline styles** and a
**beat ring** with screen edges that move with the music.

<a id="vs"></a>

## Compared with the big three

All four apps scored on the ten things that matter most to listeners. NetherFlow comes first overall, but it doesn't win
every category.

<p align="center">
  <img src="docs/media/score.png" width="100%" alt="The score, out of 100: NetherFlow 89.0, Apple Music 78.5, Spotify 78.0, YouTube Music 66.5">
</p>

| Rank | App | Score | Best at |
|:-:|:--|:-:|:--|
| 1 | **NetherFlow** | **89.0** | price, lyrics, the look, privacy, offline, together |
| 2 | **Apple Music** | **78.5** | sound quality, offline, catalog |
| 3 | **Spotify** | **78.0** | discovery, devices, together, catalog |
| 4 | **YouTube Music** | **66.5** | catalog (covers, live versions, remixes) |

NetherFlow is **first, or tied for first, in six categories**. The others beat it on catalog, sound, discovery and
devices.

<details>
<summary><b>The full breakdown, category by category</b></summary>

<sub>✓ yes · ~ partly · ✗ no</sub>

### Price and what's free

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Price (US, a month) | ✓ **Free** | $12.99 | $11.99 | $11.99 |
| Free version | ✓ everything, unlocked | ~ ads, limited on phones | ✗ just a free trial | ~ ads, no background play on phones |
| Ads | ✓ none of its own | ~ on the free version | ✓ none | ~ on the free version |
| Account | ✓ not needed | needed | Apple ID | Google account |
| **Score** | **10** | 6 | 4 | 5 |

### Catalog

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Songs | everything on YouTube, found through Apple's catalog | 100M+ | 100M+ | 100M+, plus YouTube's covers, live versions and remixes |
| Officially licensed | ✗ it plays the songs from YouTube | ✓ | ✓ | ✓ |
| Podcasts | ✓ podcasts from Apple's directory, saved for offline too | ✓ | ~ in a separate app | ✓ |
| Audiobooks | ~ free classics only (LibriVox, public domain in the US) | ✓ the bestsellers | ~ in Apple Books | ✗ |
| Can break when YouTube changes something | ~ yes, until an update fixes it | ✓ no | ✓ no | ✓ no |
| **Score** | 7 | **10** | **10** | **10** |

### Sound quality

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Best quality | ~160 kbps Opus (320 kbps from Audius when the artist uploaded it there) | Lossless, up to 24-bit/44.1 kHz | Hi-Res Lossless up to 24-bit/192 kHz, plus Dolby Atmos | 256 kbps |
| Equalizer & sound tools | ✓ built in, presets and a volume booster, plus Crossfeed, Clarity, Loudness at low volume, Night mode and 360 sound | ~ on phones | ✓ presets | ~ the phone's own (Android) |
| Headphone correction | ✓ 6,000+ headphones (AutoEQ) | ✗ | ~ Apple's own headphones | ✗ |
| **Score** | 8 | 8 | **10** | 6 |

### Lyrics

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Synced lyrics | ✓ word by word | ✓ line by line | ✓ word by word | ~ line by line, on many songs |
| Lyrics animations | ✓ 19, plus 58 Extreme looks | ✗ | ~ one style (a very good one) | ✗ |
| Karaoke | ✓ Sing | ✗ | ✓ Apple Music Sing | ✗ |
| Lyrics fonts | ✓ 13 | ✗ | ✗ | ✗ |
| **Score** | **10** | 7 | 9 | 5 |

### Look and feel

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Moving backgrounds | ✓ 27, and they move with the beat | ~ Canvas loops, when the artist made one | ~ animated album covers | ~ music videos |
| Themes that change the whole app | ✓ 6 | ✗ | ✗ | ✗ |
| Colour moods | ✓ 46 | ✗ | ✗ | ✗ |
| **Score** | **10** | 6 | 7 | 6 |

### Discovery

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Recommendations | ✓ Your mix, Discover, Radio from any song or artist, a mix for the time of day, Mix with a friend, and Autoplay that learns from what you skip and like | ✓ Discover Weekly, AI DJ, daylist | ✓ stations, personal mixes | ✓ Supermix, strong recommendations |
| Curated playlists, charts, new releases | ✓ YouTube Music's charts, moods & genres, and new releases from the artists you follow, with an alert when they're out | ✓ | ✓ | ✓ |
| Your year in music | ✓ your stats, any time | ✓ Wrapped | ✓ Replay | ✓ Recap |
| **Score** | 9 | **10** | 8 | 9 |

### Privacy and ads

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Tracking | ✓ no analytics, nothing we can read reaches us | ~ your listening shapes ads (free) and suggestions | ~ your listening shapes suggestions | ~ tied to your whole Google account |
| Open source | ✓ GPL v3 | ✗ | ✗ | ✗ |
| **Score** | **10** | 4 | 7 | 3 |

### Devices

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Phone | Android | Android, iPhone | iPhone, Android | Android, iPhone |
| Computer | Windows, Linux | Windows, Mac, Linux, web | Mac, Windows, web | ~ web only |
| TV, speakers, car, watch | ~ Android TV and Google TV, Android Auto (NetherFlow has to be open on the phone, and Android Auto lists apps from outside the Play Store only with its Unknown sources developer setting on), and lyrics on your car's display (Android) | ✓ almost everything | ✓ Apple's devices, and plenty more | ✓ many |
| **Score** | 7 | **10** | 8 | 8 |

### Offline and together

| | NetherFlow | Spotify | Apple Music | YouTube Music |
|:--|:--|:--|:--|:--|
| Download songs | ✓ free, whole playlists at once (but YouTube's terms don't allow it) | ✓ Premium, 10,000 a device | ✓ up to 100,000 in your library | ✓ Premium |
| Listen together, live | ✓ up to 10 people, any phone or PC, no account, end-to-end encrypted | ✓ Jam | ✓ SharePlay (Apple devices) | ✗ not built in |
| Share a playlist | ✓ a QR code or a link (the songs show up even without the app) | ✓ a link, or a Spotify Code to scan | ✓ a link | ✓ a link |
| Playlists you edit together | ✓ anyone with the link, live, end-to-end encrypted, no account | ✓ | ✓ | ✓ |
| **Offline score** | **10** | 9 | **10** | 9 |
| **Together score** | **9** | **9** | 7 | 5 |

</details>

### Where NetherFlow falls short

- **It isn't a licensed service.** It plays songs from YouTube, so it depends on YouTube. If YouTube changes something,
  features can break until an update fixes them
- **The sound tops out around 160 kbps.** On good headphones, Apple Music's and Spotify's lossless is clearly better
- **No iPhone and no Mac yet.** Windows, Linux, Android and Android TV
- **Audiobooks are free classics only** (LibriVox's), not the bestsellers Spotify and Apple have. Finding new music is
  good, but Spotify's is still better
- **Artists earn less from your plays** than on the paid apps, since no YouTube ads play. If you love an artist, support
  them directly: buy the merch, go to the show, or stream them on a paid app too

### Which one fits you

- **NetherFlow**: you want your music to *look and feel* extraordinary, lyrics that land on every word, and all of it free,
  with no account and no ads of its own
- **Spotify**: the best all-rounder, for finding new music and podcasts, on almost every device
- **Apple Music**: the best sound, especially on an iPhone or a Mac
- **YouTube Music**: covers, live versions and remixes nobody else has, or you already pay for YouTube Premium

You can also use NetherFlow **alongside** any of them: paste a playlist link from Spotify, Apple Music or YouTube and
it's in.

<sub>**How it's scored:** each app gets 0–10 in each category. Price and catalog count ×15 (they matter most to most
people); sound, lyrics, look, discovery, privacy and devices ×10; offline and listening together ×5. That adds up to a
total out of 100. US prices as of October 2026, from [Spotify](https://www.spotify.com/us/premium/),
[Apple](https://www.apple.com/apple-music/) and [YouTube](https://www.youtube.com/musicpremium). Spotify, Apple Music and
YouTube Music are trademarks of their respective owners. NetherFlow is not affiliated with, funded by, authorized by, endorsed by or sponsored by
any of them. The scores are the author's own opinion.</sub>

## How it works

NetherFlow doesn't host any music, videos or lyrics. It finds them on other services and plays them straight from there:

| What | From |
|:--|:--|
| Song search, artwork | Apple's iTunes Search API, YouTube Music |
| Playback | FlowStream, NetherFlow's own player: the audio and music videos from YouTube's servers, as YouTube serves them to its own apps; [Audius](https://audius.co) when the artist's own upload is there (320 kbps) |
| Lyrics | [AMLL TTML DB](https://github.com/amll-dev/amll-ttml-db) (open, word by word), [LRCLIB](https://lrclib.net), NetEase Cloud Music, Kugou, YouTube Music (lyrics by LyricFind) |
| Explore | YouTube Music's charts, new releases, moods and genres; your mixes from its radio for the songs you play most |
| Podcasts | Apple's podcast directory and charts; the episodes from each show's own feed and host |
| Audiobooks | [LibriVox](https://librivox.org)'s recordings (public domain in the US), from the [Internet Archive](https://archive.org) |
| Headphone correction | [AutoEQ](https://github.com/jaakkopasanen/AutoEq)'s published results (MIT), fetched when you pick your headphones |
| Playlists you make together | NetherFlow's own relay on Cloudflare (public MQTT relays as a backup), end-to-end encrypted with a key from the playlist link |
| Saving for offline | FlowStream saves the audio from YouTube, as YouTube serves it (its best, usually Opus); podcast episodes and audiobook chapters come as their host serves them |
| Redline's circuits | [OpenStreetMap](https://www.openstreetmap.org/copyright) map data and NASA's SRTM heights, made into `race/` ahead of time |

The desktop app (Windows and Linux) is [Electron](https://www.electronjs.org), the Android app (phones and TVs) is
[Capacitor](https://capacitorjs.com), and both run the same page, `index.html`. FlowStream (`flowstream.js`) is
NetherFlow's own code; it asks YouTube as two of YouTube's own apps do (the client details credited to
[yt-dlp](https://github.com/yt-dlp/yt-dlp), which documents them).
Redline's races are drawn with [three.js](https://threejs.org).

## Building from source

You need [Node.js](https://nodejs.org) 20 or newer.

**Windows**

```bash
npm ci
npm start      # run it
npm run dist   # build the installer and the portable app into dist/
npm test       # a quick self-test: plays a song and checks the lyrics sync
```

NetherFlow Lite: `npx electron-builder --win nsis portable --publish never --config tools/lite-build.js` (into `dist/lite`).

Discord status uses NetherFlow's own application at Discord (its id, public, is `DISCORD_ID` in `main.js`; a fork can
use its own there or with the `NETHERFLOW_DISCORD_ID` environment variable). Its logo, for Discord, is in `docs/logo/`.

**Linux** (on Linux; GitHub's Ubuntu builds the releases' with `.github/workflows/linux.yml`)

```bash
npm ci
npm run dist:linux   # an AppImage and a .deb into dist/
```

**Android**: you also need JDK 21 and the Android SDK (API level 36).

```bash
npm ci
npm run android:sync              # copies the page into the Android project
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. Release builds are signed only if a signing key is set up
outside the repository, in `~/.netherflow-signing/` (or the folder named by `NETHERFLOW_SIGNING`): a
`keystore.properties` with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`, next to the key file. Otherwise
they come out unsigned (as F-Droid wants them). On Windows,
`android-build.cmd` does all of this.

## Contributing

Bug reports, ideas for themes and backgrounds, and fixes are all welcome. [Open an issue](https://github.com/volodya-rua/NetherFlow/issues/new/choose)
to report a problem or suggest something, and see [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.
Security issues go privately, as described in [SECURITY.md](SECURITY.md).

<a id="hucla"></a>

## Built by a human and an AI

NetherFlow is a **HuCla** build: **Hu**man × **Cla**ude.

The idea and the vision are Volodya.rua's: what NetherFlow should be, how it looks and feels, every theme and every
background. Every build was tested on a PC and a phone and sent back until it was right.

Most of the code was written by **[Claude](https://www.anthropic.com/claude)**, Anthropic's AI: the player, the lyrics
engine, every shader behind the backgrounds, the 3D races, the Android app, and most of this README. Every commit
Claude worked on says so with a `Co-Authored-By: Claude` line.

## Privacy

NetherFlow has no accounts and no analytics, and nothing it sends reaches its developer in a form anyone there can read. Your settings, library and saved songs
stay on your device. When you use it, it talks directly to the services above (GitHub too: to look for a newer NetherFlow, and for word-by-word lyrics from the AMLL TTML DB; podcast hosts and the Internet Archive for podcasts and audiobooks), which see your IP address. A
playlist you share lives only inside its link (the page it opens, on GitHub Pages, never gets the songs part); one you
edit together is kept on NetherFlow's own relay (on Cloudflare; for now public relays too, as a backup), encrypted with a key from its link, so anyone with the link can read and change it. The full [Privacy Policy](https://volodya-rua.github.io/NetherFlow/legal.html#privacy) is in the app and on the website.

## Legal

- NetherFlow is an independent project. It is **not affiliated with, funded by, authorized by, endorsed by or sponsored by** YouTube, Google,
  Apple, Audius, LRCLIB, NetEase, Kugou, the AMLL lyrics database, LyricFind, the Internet Archive, LibriVox, AutoEQ, any podcast or its publisher,
  or any artist, label or publisher. All names, trademarks, music,
  videos, lyrics and artwork belong to their respective owners.
- NetherFlow **hosts no content**. Everything it plays comes straight from the services above to your device.
- **Saving for offline downloads from YouTube, which YouTube's Terms of Service don't allow**, and copyright law where
  you live may not allow it either. Whether to use it is your choice and your responsibility: only save what you're
  allowed to keep, for your own personal listening.
- NetherFlow plays songs straight from YouTube, so no ads play; it doesn't block or skip anything.
- The [Terms of Use](https://volodya-rua.github.io/NetherFlow/legal.html#terms) apply to using the app. If you hold rights in something and have a concern,
  contact the developer (below): every notice is reviewed in good faith.
- Redline's 3D races are built from [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)' map data:
  the circuits and what's round them (ODbL 1.0, as are `race/tracks.json` and `race/maps/`, made from it by
  `tools/race-tracks.js`), with heights from NASA's SRTM (public domain) through OpenTopoData. The cars are CC BY 4.0
  models from Sketchfab, credited in `race/cars.json` and the app (they come inside it); the cars' makers don't endorse
  or sponsor NetherFlow. The race images here show map data © OpenStreetMap contributors.
- The software is provided **as is**, without warranty of any kind (see the license).

## License

NetherFlow is © 2026 Volodya.rua and released under the [GNU General Public License v3](LICENSE), with a few additional
terms in [NOTICE](NOTICE):

- **Use it, change it, share it.** Anyone can, as long as their version stays open source under the same license
- **Keep the credit.** Every copy and every changed version shows "NetherFlow by Volodya.rua", with a link here, in
  its credits
- **A name and logo of its own.** A changed version needs its own name and icon. The NetherFlow name and logo aren't
  licensed to anyone

NetherFlow 1.3.1 and earlier came out under the MIT License, and copies of those keep it.

Third-party code in this repository keeps its own license: the 27 typefaces in `fonts/` (SIL Open Font License 1.1; Permanent Marker, Special
Elite and Yellowtail under the Apache License 2.0), Microsoft's Fluent Emoji in `emoji/` (MIT), and three.js in
`race/three/` (MIT). The three songs on the website in `docs/media/music/` are by HoliznaCC0, in the public domain
(CC0 1.0). The builds also include Electron (with Chromium, Node.js and FFmpeg), Capacitor and electron-updater, each under its own license. All
license texts are in [`licenses/`](licenses); the full list of components is in the app under About › Licenses.

<a id="hit-me-up"></a>

## Contact

Questions, bug reports and theme ideas are welcome. [Open an issue](https://github.com/volodya-rua/NetherFlow/issues), or
reach Volodya.rua on [Instagram](https://www.instagram.com/volodya.rua/) or by [email](mailto:volodya.rua@gmail.com).

<p align="center"><sub>NetherFlow by <b>Volodya.rua</b> · a HuCla build</sub></p>
