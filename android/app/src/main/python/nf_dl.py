# NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
# NetherFlow (Android): saving a song for offline — yt-dlp downloads its audio from its YouTube upload, as YouTube has
# it (usually Opus in WebM). Called by YtDlPlugin.java.
#
# yt-dlp comes with the app (src/main/python/yt_dlp), but YouTube changes often and old copies stop working, so if the
# user turns on "Update the downloader", the newest release is fetched now and then into HOME (update()) and used in
# its place. Turned off, forget() goes back to the one that came with the app.
import json
import os
import sys
import urllib.request

HOME = os.environ['HOME']
LATEST = os.path.join(HOME, 'yt-dlp.zip')  # the newest release (a zip of the yt_dlp package, importable as it is)
CHECKED = os.path.join(HOME, 'yt-dlp.checked')  # touched each time the newest release is looked up
RELEASES = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'


# (YtDlPlugin runs prepare() and update() with no download running, and downloads several at once otherwise)


def _unload():
    # (with what came in its zip, e.g. yt_dlp_ejs, and its plugin finders, which outlive it in sys.meta_path: they'd
    # keep reading a zip that may be gone)
    sys.meta_path[:] = [f for f in sys.meta_path if not type(f).__module__.startswith('yt_dlp')]
    for name, m in list(sys.modules.items()):
        if name.split('.')[0] in ('yt_dlp', 'yt_dlp_plugins') or str(getattr(m, '__file__', '')).startswith(LATEST):
            del sys.modules[name]
    sys.path_importer_cache.pop(LATEST, None)


def prepare():
    """Use the newest copy of yt_dlp there is (imported afresh if update() just fetched a newer one)."""
    if os.path.exists(LATEST) and LATEST not in sys.path:
        sys.path.insert(0, LATEST)
        _unload()
    import yt_dlp  # noqa: F401


def forget():
    """Back to the yt_dlp that came with the app: the fetched one is deleted."""
    if LATEST in sys.path:
        sys.path.remove(LATEST)
        _unload()
    for f in (LATEST, CHECKED):
        if os.path.exists(f):
            os.remove(f)
    import yt_dlp  # noqa: F401


def checked_at():
    return os.path.getmtime(CHECKED) if os.path.exists(CHECKED) else 0


def update():
    """Fetch yt-dlp's newest release if it's newer than the one in use. True if there is a new one."""
    with urllib.request.urlopen(RELEASES, timeout=20) as r:
        release = json.load(r)
    open(CHECKED, 'w').close()
    prepare()
    from yt_dlp.version import __version__ as current
    if release['tag_name'] <= current:
        return False
    url = next(a['browser_download_url'] for a in release['assets'] if a['name'] == 'yt-dlp')
    part = LATEST + '.part'
    with urllib.request.urlopen(url, timeout=60) as r, open(part, 'wb') as f:
        f.write(r.read())
    if LATEST in sys.path:
        sys.path.remove(LATEST)
    os.replace(part, LATEST)
    prepare()
    return True


def download(video_id, out_dir, key, listener):
    """Download the best audio-only stream of a YouTube video into out_dir/<key>.<ext>.
    listener.progress(fraction) as it comes in; listener.cancelled() is asked as it goes. Returns
    [path, duration in seconds]."""
    import yt_dlp

    def hook(d):
        if listener.cancelled():
            raise yt_dlp.utils.DownloadCancelled('cancelled')
        total = d.get('total_bytes') or d.get('total_bytes_estimate')
        if d.get('status') == 'downloading' and total:
            listener.progress(min(1.0, d.get('downloaded_bytes', 0) / total))

    options = {
        'format': 'bestaudio',
        'outtmpl': os.path.join(out_dir, key + '.%(ext)s'),
        'noplaylist': True, 'nopart': True, 'updatetime': False,
        'concurrent_fragment_downloads': 4,
        'cachedir': os.path.join(HOME, 'yt-dlp-cache'),
        'quiet': True, 'no_warnings': True, 'noprogress': True,
        'progress_hooks': [hook],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info('https://www.youtube.com/watch?v=' + video_id, download=True)
    path = info['requested_downloads'][0]['filepath']
    return [path, float(info.get('duration') or 0)]
