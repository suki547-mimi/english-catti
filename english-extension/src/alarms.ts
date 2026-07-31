import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { UserStore } from './store';

/** One in-memory timer per alarm time so we don't fire twice. */
const scheduledTimers: NodeJS.Timeout[] = [];
/** Persistent "already fired today" state, mirrored to disk so
 *  Reload Window doesn't cause double fires or missed catch-ups. */
let firedState: Record<string, string> = {};   // { "HH:MM": "YYYY-MM-DD" }
let firedStatePath: string | undefined;
let alarmsChannel: vscode.OutputChannel | undefined;
let alarmStatusBar: vscode.StatusBarItem | undefined;

function log(msg: string) {
  if (!alarmsChannel) { alarmsChannel = vscode.window.createOutputChannel('English CATTI · Alarms'); }
  const ts = new Date().toISOString().slice(11, 19);
  alarmsChannel.appendLine(`[${ts}] ${msg}`);
}

interface AlarmConfig {
  enabled: boolean;
  times: string[];
  skipIfDone: boolean;
  modal: boolean;
}

function readConfig(): AlarmConfig {
  const cfg = vscode.workspace.getConfiguration('englishCatti.alarms');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    times: cfg.get<string[]>('times', ['10:00', '15:00']),
    skipIfDone: cfg.get<boolean>('skipIfDone', true),
    modal: cfg.get<boolean>('modal', true),
  };
}

function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadFiredState(dataRoot: string | undefined) {
  if (!dataRoot) { return; }
  firedStatePath = path.join(dataRoot, 'data', 'alarm_state.json');
  try {
    if (fs.existsSync(firedStatePath)) {
      const raw = fs.readFileSync(firedStatePath, 'utf8');
      const parsed = JSON.parse(raw);
      firedState = (parsed && typeof parsed.lastFired === 'object') ? parsed.lastFired : {};
    }
  } catch { firedState = {}; }
}

function saveFiredState() {
  if (!firedStatePath) { return; }
  try {
    fs.mkdirSync(path.dirname(firedStatePath), { recursive: true });
    fs.writeFileSync(firedStatePath, JSON.stringify({ lastFired: firedState }, null, 2), 'utf8');
  } catch (e: any) {
    log(`saveFiredState failed: ${e?.message || e}`);
  }
}

/** Compute ms until the next occurrence of HH:MM from `now`. */
function msUntilNext(hhmm: string, now: Date = new Date()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) { return null; }
  const target = new Date(now);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (target.getTime() <= now.getTime()) { target.setDate(target.getDate() + 1); }
  return target.getTime() - now.getTime();
}

/** Fire the notification for a specific time slot. */
async function fireAlarm(hhmm: string, dataRoot: string | undefined, force = false) {
  const cfg = readConfig();
  const today = todayKey();
  // De-dup: don't re-fire same slot on same day (unless forced)
  if (!force && firedState[hhmm] === today) {
    log(`fireAlarm ${hhmm} skipped (already fired today)`);
    return;
  }

  // Optionally skip if today's targets are all done
  if (!force && cfg.skipIfDone && dataRoot) {
    try {
      const store = new UserStore(path.join(dataRoot, 'data'));
      const summary = store.summary();
      const newDoneToday = summary.today_stats.new_words || 0;
      const dueToday = summary.due_today || 0;
      if (newDoneToday >= 10 && dueToday === 0) {
        log(`fireAlarm ${hhmm} skipped (today's targets already done: new=${newDoneToday}, due=${dueToday})`);
        firedState[hhmm] = today;
        saveFiredState();
        return;
      }
    } catch { /* ignore */ }
  }

  log(`fireAlarm ${hhmm} FIRING`);
  firedState[hhmm] = today;
  saveFiredState();

  // Highlight status bar so user notices even if they blink through the toast
  if (alarmStatusBar) {
    alarmStatusBar.text = `$(alert) CATTI 提醒！`;
    alarmStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  // Show a rich notification with 3 quick actions
  const pickLearn = '🌱 学习';
  const pickReview = '🔁 复习';
  const pickReading = '📚 读书角';
  const pickSnooze = '再等 10 分钟';
  const message = `⏰ ${hhmm} — CATTI 学习时间到了！今天目标：10 词 + 已到期复习。`;
  const options = cfg.modal ? { modal: true } : {};
  const choice = await vscode.window.showInformationMessage(
    message,
    options,
    pickLearn, pickReview, pickReading, pickSnooze,
  );
  // Reset status bar to normal after user responds (or dismisses)
  if (alarmStatusBar) {
    alarmStatusBar.backgroundColor = undefined;
    updateStatusBar(cfg);
  }
  if (!choice) { return; }
  if (choice === pickSnooze) {
    setTimeout(() => {
      // Clear firedState for this slot so we can re-notify
      delete firedState[hhmm];
      saveFiredState();
      fireAlarm(hhmm, dataRoot);
    }, 10 * 60 * 1000);
    return;
  }
  const cmdMap: Record<string, string> = {
    [pickLearn]: 'englishCatti.learn',
    [pickReview]: 'englishCatti.review',
    [pickReading]: 'englishCatti.reading',
  };
  const cmd = cmdMap[choice];
  if (cmd) {
    try { await vscode.commands.executeCommand(cmd); } catch { /* ignore */ }
  }
}

/** Schedule one alarm slot. Recursively reschedules for the next day when it fires. */
function scheduleOne(hhmm: string, dataRoot: string | undefined) {
  const delay = msUntilNext(hhmm);
  if (delay === null) { return; }
  const timer = setTimeout(async () => {
    await fireAlarm(hhmm, dataRoot);
    // Schedule the next occurrence (next day at same time)
    scheduleOne(hhmm, dataRoot);
  }, delay);
  scheduledTimers.push(timer);
}

/** Check if any of today's alarms were "missed" — i.e. VS Code wasn't open
 *  when they were supposed to fire. Show a single catch-up notification. */
async function catchUpMissed(cfg: AlarmConfig, dataRoot: string | undefined) {
  const now = new Date();
  const today = todayKey(now);
  const missed: string[] = [];
  for (const t of cfg.times) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) { continue; }
    const slotToday = new Date(now);
    slotToday.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (slotToday.getTime() <= now.getTime() && firedState[t] !== today) {
      missed.push(t);
    }
  }
  if (missed.length === 0) { return; }
  log(`catch-up: found ${missed.length} missed alarm(s) today: ${missed.join(', ')}`);
  // Fire the most recent one immediately (rather than spamming N notifications)
  const mostRecent = missed[missed.length - 1];
  // Mark the earlier ones as "handled" so they don't fire tomorrow's first thing
  for (const t of missed.slice(0, -1)) { firedState[t] = today; }
  saveFiredState();
  await fireAlarm(mostRecent, dataRoot);
}

function updateStatusBar(cfg: AlarmConfig) {
  if (!alarmStatusBar) {
    alarmStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    alarmStatusBar.command = 'englishCatti.configureAlarms';
    alarmStatusBar.tooltip = '点击配置每日提醒时间';
  }
  if (!cfg.enabled || cfg.times.length === 0) {
    alarmStatusBar.hide();
    return;
  }
  const now = new Date();
  const today = todayKey(now);
  let nextTime = '';
  let nextDelayMs = Infinity;
  for (const t of cfg.times) {
    const d = msUntilNext(t, now);
    if (d !== null && d < nextDelayMs) { nextDelayMs = d; nextTime = t; }
  }
  const nextIsTomorrow = nextDelayMs > (24 * 60 * 60 * 1000 - 60 * 1000);
  const doneMark = firedState[nextTime] === today ? ' ✓' : '';
  alarmStatusBar.text = `$(bell) ${nextTime}${doneMark}${nextIsTomorrow ? ' (明日)' : ''}`;
  alarmStatusBar.show();
}

/** Clear all scheduled alarms and reschedule based on current config. */
export function refreshAlarms(context: vscode.ExtensionContext, dataRoot: string | undefined) {
  loadFiredState(dataRoot);
  for (const t of scheduledTimers) { clearTimeout(t); }
  scheduledTimers.length = 0;
  const cfg = readConfig();
  if (!cfg.enabled) {
    log('alarms disabled by config');
    if (alarmStatusBar) { alarmStatusBar.hide(); }
    return;
  }
  for (const t of cfg.times) { scheduleOne(t, dataRoot); }
  log(`scheduled ${cfg.times.length} alarm(s): ${cfg.times.join(', ')}`);
  updateStatusBar(cfg);
  // Refresh status bar every minute so "next" time stays accurate
  const barTimer = setInterval(() => updateStatusBar(cfg), 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(barTimer) });
  // Catch up missed alarms (VS Code was closed when they should have fired)
  catchUpMissed(cfg, dataRoot).catch((e) => log(`catchUpMissed error: ${e?.message || e}`));
}

/** Test command — fire an alarm right now to verify the pipeline works. */
export async function testAlarmNow(dataRoot: string | undefined) {
  log('testAlarmNow triggered by user');
  const now = new Date();
  const label = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  await fireAlarm(label, dataRoot, true);
}

/** Interactive: let the user pick times via QuickPick and save to settings. */
export async function configureAlarmsInteractive(context: vscode.ExtensionContext, dataRoot: string | undefined) {
  const cfg = readConfig();
  const input = await vscode.window.showInputBox({
    prompt: '每日提醒时间（逗号分隔的 HH:MM，24 小时制）',
    value: cfg.times.join(', '),
    placeHolder: '例：09:00, 14:00, 20:30',
    validateInput: (v) => {
      const parts = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(p)) { return `无效时间："${p}"（用 HH:MM）`; }
      }
      return null;
    },
  });
  if (input === undefined) { return; }
  const times = input.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  await vscode.workspace.getConfiguration('englishCatti.alarms').update('times', times, vscode.ConfigurationTarget.Global);
  refreshAlarms(context, dataRoot);
  vscode.window.showInformationMessage(`✅ 每日提醒已更新：${times.join(' / ')}`);
}

/** OS-level: create Windows Task Scheduler tasks so notifications fire even
 *  when VS Code is closed. Uses schtasks.exe. Each task shows a toast via
 *  PowerShell's BurntToast-style balloon; if BurntToast isn't available it
 *  falls back to a plain msg.exe popup. */
export async function installOSAlarms(dataRoot: string | undefined) {
  const cfg = readConfig();
  if (cfg.times.length === 0) {
    vscode.window.showWarningMessage('没有配置任何提醒时间。');
    return;
  }
  const confirm = await vscode.window.showInformationMessage(
    `将在 Windows 任务计划里创建 ${cfg.times.length} 个每日提醒任务（${cfg.times.join(', ')}）。这样即使 VS Code 关着也能收到通知。继续？`,
    { modal: true }, '继续', '取消',
  );
  if (confirm !== '继续') { return; }
  const scriptDir = dataRoot ? path.join(dataRoot, 'data') : path.join(process.env.LOCALAPPDATA || 'C:\\', 'EnglishCATTI');
  fs.mkdirSync(scriptDir, { recursive: true });
  const psScript = path.join(scriptDir, 'notify_alarm.ps1');
  fs.writeFileSync(psScript, `# CATTI daily alarm
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = "English CATTI"
$notify.BalloonTipText = "该学英语了~ 快打开 VS Code (Ctrl+Alt+E)"
$notify.BalloonTipIcon = "Info"
$notify.ShowBalloonTip(10000)
Start-Sleep -Seconds 12
$notify.Dispose()
`, 'utf8');
  let created = 0;
  const errors: string[] = [];
  for (const t of cfg.times) {
    const taskName = `EnglishCATTI_Alarm_${t.replace(':', '')}`;
    try {
      await runProcess('schtasks.exe', ['/Delete', '/TN', taskName, '/F']);
    } catch { /* ignore */ }
    const args = [
      '/Create', '/TN', taskName,
      '/TR', `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psScript}"`,
      '/SC', 'DAILY',
      '/ST', t,
      '/F',
    ];
    try {
      await runProcess('schtasks.exe', args);
      created++;
    } catch (e: any) {
      errors.push(`${t}: ${e?.message || e}`);
    }
  }
  if (errors.length === 0) {
    vscode.window.showInformationMessage(`✅ 已在系统任务计划里创建 ${created} 个提醒。`);
  } else {
    vscode.window.showWarningMessage(`创建了 ${created} 个，${errors.length} 个失败：${errors.join(' | ')}`);
  }
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) { resolve(); }
      else { reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 150)}`)); }
    });
  });
}
