// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Voice control on Windows (the mic by Search): one sentence from the microphone, as words, by Windows' own speech
// recognition — a PowerShell child running VOICE_PS. Microsoft's online dictation where Windows' own "Online speech
// recognition" setting is on (as Windows' voice typing uses it), else Windows' offline recognizer, helped by the
// library's own names (its artists, playlists and songs: what's said is most likely one of them). Nothing's kept: the
// sound goes to the recognizer, the words come back. The page asks (voice-listen, with those names) and hears
// 'listening' once it is; voice-stop: given up.
const { spawn } = require('child_process');

// (run with $Wav set before it: '' — the microphone — or a recording's path)
const VOICE_PS = String.raw`$ErrorActionPreference = 'Stop'
function Done($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); exit 0 }
# (the names, each its own: Windows PowerShell hands a JSON list on as one thing, so it's gone through by hand)
$words = @(); try { $raw = [Console]::In.ReadToEnd(); if ($raw) { foreach ($w in (ConvertFrom-Json $raw)) { $words += "$w" } } } catch {}
# online: only where Windows' own setting allows it (and never for a test's recording)
$online = $false
if (-not $Wav) { $k = Get-ItemProperty 'HKCU:\Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy' -ErrorAction SilentlyContinue; $online = [bool]($k -and $k.HasAccepted -eq 1) }
if ($online) {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
    function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
    $null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
    $sr = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
    $c = Await ($sr.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
    if ("$($c.Status)" -eq 'Success') {
      $sr.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6); $sr.Timeouts.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)
      [Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
      $r = Await ($sr.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
      if ("$($r.Status)" -eq 'Success') { Done @{ text = "$($r.Text)"; how = 'online' } }
    }
  } catch {}
}
# offline: Windows' own recognizer — the app's commands, the library's names (with or without "play" before them), and
# plain dictation for anything else
Add-Type -AssemblyName System.Speech
try { $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine } catch {
  $first = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Select-Object -First 1
  if (-not $first) { Done @{ text = ''; why = 'language' } }
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine($first)
}
$cmds = [string[]]@('next', 'next song', 'skip', 'previous', 'previous song', 'go back', 'pause', 'stop', 'play', 'resume', 'carry on', 'louder', 'quieter', 'volume up', 'volume down', 'turn it up', 'turn it down', 'shuffle', 'shuffle off', 'repeat this', 'repeat off', 'like this', 'like this song', "what's playing", 'what song is this', 'songs like this', 'play my liked songs', 'play my downloads', 'sing')
$e.LoadGrammar((New-Object System.Speech.Recognition.Grammar((New-Object System.Speech.Recognition.GrammarBuilder((New-Object System.Speech.Recognition.Choices($cmds)))))))
$names = [string[]]@($words | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match "^[A-Za-z0-9 '&.-]{2,40}$" } | Select-Object -Unique -First 1500)
if ($names.Count) {
  try {
    $gb = New-Object System.Speech.Recognition.GrammarBuilder
    $gb.Append((New-Object System.Speech.Recognition.GrammarBuilder((New-Object System.Speech.Recognition.Choices([string[]]@('play', 'play the playlist', 'play songs by'))))), 0, 1)
    $gb.Append((New-Object System.Speech.Recognition.Choices($names)))
    $g = New-Object System.Speech.Recognition.Grammar($gb); $g.Weight = 0.9; $e.LoadGrammar($g)
  } catch {}
}
$d = New-Object System.Speech.Recognition.DictationGrammar; $d.Weight = 0.3; $e.LoadGrammar($d)
try { if ($Wav) { $e.SetInputToWaveFile($Wav) } else { $e.SetInputToDefaultAudioDevice() } } catch { Done @{ text = ''; why = 'no microphone' } }
$e.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6); $e.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2); $e.BabbleTimeout = [TimeSpan]::FromSeconds(0)
# (an English recognizer is never sure of "Sid Sriram" or "Arijit Singh": a near match of the commands and names is let
# through rather than thrown away — what it hears is most likely one of them)
try { $e.UpdateRecognizerSetting('CFGConfidenceRejectionThreshold', 5) } catch {}
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
try { $r = $e.Recognize([TimeSpan]::FromSeconds(12)) } catch { Done @{ text = ''; why = 'no microphone' } }
if ($r -and $r.Text) { Done @{ text = "$($r.Text)"; how = 'offline'; alts = @($r.Alternates | ForEach-Object { "$($_.Text)" }) } }
Done @{ text = ''; why = 'nothing heard' }
`;

let child = null;
// one sentence → { text, how ('online' | 'offline'), alts } or { text: '', why }; ready(): it's listening now.
// (wav: a recording in place of the microphone — the checks', never the app's)
function listen(words, ready = () => {}, wav = '') {
  if (process.platform !== 'win32') return Promise.resolve({ text: '', why: 'unavailable' });
  if (child) child.kill();
  // (the script handed over on its command line, encoded as PowerShell takes it: never a file of it anywhere — Legal's point)
  const script = `$Wav = '${String(wav).replace(/'/g, "''")}'\n` + VOICE_PS;
  return new Promise(res => {
    let out = '', said = false, settled = false;
    const end = r => { if (settled) return; settled = true; clearTimeout(timer); res(r); };
    const c = child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    const timer = setTimeout(() => c.kill(), 25000);
    c.stdout.on('data', d => { out += d; if (!said && /^READY\s*$/m.test(out)) { said = true; ready(); } });
    c.on('error', () => end({ text: '', why: 'busy' }));
    c.on('close', () => {
      if (child === c) child = null;
      const line = out.split(/\r?\n/).reverse().find(l => l.startsWith('{'));
      try { end(JSON.parse(line)); } catch { end({ text: '', why: said ? 'nothing heard' : 'busy' }); }
    });
    c.stdin.on('error', () => {});
    c.stdin.end(JSON.stringify((words || []).slice(0, 1500).map(String)));
  });
}

function register(ipcMain, getWin) {
  const mine = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  ipcMain.handle('voice-listen', (e, words) => !mine(e) ? { text: '', why: 'busy' }
    : listen(Array.isArray(words) ? words : [], () => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('voice-event', { state: 'listening' }); }));
  ipcMain.on('voice-stop', e => { if (mine(e) && child) child.kill(); });
}
module.exports = { register, listen };
