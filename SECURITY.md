# Security policy

Thanks for helping keep NetherFlow and the people who use it safe. If you've found a security problem, please report it
privately as described here, not in a public issue, discussion or post.

## Supported versions

Only the latest release gets security fixes, whether it came from
[GitHub](https://github.com/volodya-rua/NetherFlow/releases/latest) or F-Droid. If you're on an older version, please
update first and check that the problem is still there.

## How to report

Use either:

- **GitHub's private reporting:** [report a vulnerability](https://github.com/volodya-rua/NetherFlow/security/advisories/new)
  (only you and the developer can see it), or
- **Email:** [volodya.rua@gmail.com](mailto:volodya.rua@gmail.com), with "NetherFlow security" in the subject.

Please include:

- what the problem is and what someone could do with it
- the NetherFlow version and platform (Windows, Linux, Android or Android TV)
- the steps to reproduce it, or a proof of concept
- whether you'd like to be credited, and under what name

## What happens next

- You'll get a reply within **7 days** saying the report arrived.
- The developer checks it and keeps you posted on what's being done.
- A confirmed problem is fixed in a new release, with the release notes saying what was fixed. The aim is to fix it
  within **90 days**, sooner when users are at risk.
- Please keep the details private until the fix is out, or until 90 days have passed, whichever comes first. If more
  time is needed, the developer will ask you and explain why.
- You're credited in the release notes if you'd like to be.

NetherFlow is free and made by one person, so there's no bug bounty.

## What's in scope

NetherFlow's own code in this repository, including:

- the desktop app (Windows and Linux) and the Android app, including Android TV
- the in-app updates and how they're checked and signed
- the encryption of Listen together, phone and PC sync, and playlists you edit together
- the app's local server, and anything that reaches the device from outside
- the website (volodya-rua.github.io/NetherFlow) and its shared-playlist page

Out of scope:

- **Problems in the services NetherFlow uses** (YouTube, Apple, Spotify, Audius, the lyrics services, the public MQTT
  relays, GitHub, F-Droid and others). Report those to the service.
- **Problems in the components NetherFlow includes** (Electron and Chromium, Capacitor,
  and the others listed under About › Licenses). Report those upstream. But do tell us if a NetherFlow release ships a
  version with a known vulnerability.
- Denial of service, spam, social engineering, and attacks that need someone's unlocked device in your hands.

## Good-faith research

The developer won't take legal action against research done in good faith under this policy. That means you:

- only test against your own devices, accounts and data
- don't access, change or keep anyone else's data, and stop and report if you come across it
- don't flood or disrupt the public relays, GitHub or any other service
- give a reasonable time to fix the problem before telling anyone else

Thank you.
