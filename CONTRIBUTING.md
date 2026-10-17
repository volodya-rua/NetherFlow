# Contributing to NetherFlow

Thanks for helping make NetherFlow better. This page covers how to report a problem, suggest an idea, and send a change.

Everyone taking part in issues, discussions and pull requests is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Report a bug

1. Make sure you're on the [latest release](https://github.com/volodya-rua/NetherFlow/releases/latest); the problem may
   already be fixed.
2. Search the [open issues](https://github.com/volodya-rua/NetherFlow/issues) in case someone has reported it.
3. [Open a bug report](https://github.com/volodya-rua/NetherFlow/issues/new/choose) with the version, the platform
   (Windows, Linux, Android or Android TV), what you did, what happened and what you expected.

Security problems are the exception: report them privately, as described in [SECURITY.md](SECURITY.md), never in a
public issue.

## Suggest an idea

Ideas for themes, backgrounds, lyric looks and features are welcome. [Open a feature request](https://github.com/volodya-rua/NetherFlow/issues/new/choose)
and describe what you'd like and why. A screenshot or a sketch helps.

## Send a change

For anything bigger than a small fix, open an issue first so the approach can be agreed before you spend time on it.

1. Build and run NetherFlow as described in [Building from source](README.md#building-from-source). `npm test` runs a
   quick self-test that plays a song and checks the lyrics sync.
2. Keep each pull request to one change, and describe what it changes and how you tested it, on which platforms.
3. Start every new source file with the one-line license notice at the top of `main.js`.
4. Third-party code, fonts, images or sounds need their license text in [`licenses/`](licenses) and a line in
   [NOTICE](NOTICE).

NetherFlow has no accounts, no analytics and no ads of its own, and it stays that way. Changes that add tracking, ads or
sign-ins won't be merged, and a change that makes NetherFlow talk to a new online service needs a privacy review first,
so mention it in the pull request.

## License

NetherFlow is released under the [GNU General Public License v3](LICENSE) only, with the additional terms in
[NOTICE](NOTICE). By sending a contribution, you agree that it is released under the same license and terms.
