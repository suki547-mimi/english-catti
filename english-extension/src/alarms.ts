import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { UserStore } from './store';

/** One in-memory timer per alarm time so we don't fire twice. */
const scheduledTimers: NodeJS.Timeout[] = [];
/** Track dates already fired per HH:MM slot so a reschedule doesn't double-fire. */
const firedToday = new Map<string, string>();   // key `HH:MM` -> YYYY-MM-DD

interface AlarmConfig {
  enabled: boolean;
  times: string[];
  skipIfDone: boolean;
}

function readConfig(): AlarmConfig {
  const cfg = vscode.workspace.getConfiguration('englishCatti.alarms');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    times: cfg.get<string[]>('times', ['10:00', '15:00', '20:00']),
    skipIfDone: cfg.get<boolean>('skipIfDone', true),
  };
}

function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
async function fireAlarm(hhmm: string, dataRoot: string | undefined) {
  const cfg = readConfig();
  // De-dup: don't re-fire same slot on same day
  const key = todayKey();
  if (firedToday.get(hhmm) === key) { return; }
  firedToday.set(hhmm, key);

  // Optionally skip if today's targets are all done
  if (cfg.skipIfDone && dataRoot) {
    try {
      const store = new UserStore(path.join(dataRoot, 'data'));
      const summary = store.summary();
      const newDoneToday = summary.today_stats.new_words || 0;
      const dueToday = summary.due_today || 0;
      if (newDoneToday >= 10 && dueToday === 0) {
        console.log(`[alarm] ${hhmm} skipped (today's targets already done)`);
        return;
      }
    } catch { /* ignore */ }
  }

  // Show a rich notification with 3 quick actions
  const pickLearn = '🌱 学习';
  const pickReview = '🔁 复习';
  const pickReading = '📚 读书角';
  const pickSnooze = '再等 10 分钟';
  const choice = await vscode.window.showInformationMessage(
    `⏰ ${hhmm} — CATTI 学习时间到！今天目标：10 词 + 已到期复习。`,
    pickLearn, pickReview, pickReading, pickSnooze,
  );
  if (!choice) { return; }
  if (choice === pickSnooze) {
    setTimeout(() => {
      // Clear firedToday so we can re-notify
      firedToday.delete(hhmm);
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

/** Clear all scheduled alarms and reschedule based on current config. */
export function refreshAlarms(context: vscode.ExtensionContext, dataRoot: string | undefined) {
  for (const t of scheduledTimers) { clearTimeout(t); }
  scheduledTimers.length = 0;
  const cfg = readConfig();
  if (!cfg.enabled) {
    console.log('[alarm] disabled by config');
    return;
  }
  for (const t of cfg.times) { scheduleOne(t, dataRoot); }
  console.log(`[alarm] scheduled: ${cfg.times.join(', ')}`);
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
  // Compose a PowerShell one-liner that shows a Windows toast
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
    // Delete existing task with same name silently
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
