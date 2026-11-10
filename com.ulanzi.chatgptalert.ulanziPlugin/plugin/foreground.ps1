param([int]$ParentProcessId)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class ChatGPTForeground
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    public static int Read(IntPtr window)
    {
        if (window == IntPtr.Zero) return -1;
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        try
        {
            using (var process = Process.GetProcessById((int)processId))
            {
                return String.Equals(process.ProcessName, "ChatGPT",
                    StringComparison.OrdinalIgnoreCase) ? 1 : 0;
            }
        }
        catch (ArgumentException) { return -1; }
        catch (InvalidOperationException) { return -1; }
        catch (System.ComponentModel.Win32Exception) { return -1; }
    }

    public static bool ParentAlive(int processId)
    {
        try
        {
            using (var process = Process.GetProcessById(processId))
                return !process.HasExited;
        }
        catch (ArgumentException) { return false; }
    }
}
"@

$lastWindow = [IntPtr]::Zero
$lastState = -1
while ([ChatGPTForeground]::ParentAlive($ParentProcessId)) {
    $window = [ChatGPTForeground]::GetForegroundWindow()
    if ($window -ne $lastWindow -or $lastState -eq -1) {
        $state = [ChatGPTForeground]::Read($window)
        if ($state -ge 0) {
            $lastWindow = $window
            if ($state -ne $lastState) {
                $lastState = $state
                $focused = if ($state -eq 1) { 'true' } else { 'false' }
                $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                [Console]::WriteLine('{"focused":' + $focused + ',"at":' + $at + '}')
            }
        }
    }
    Start-Sleep -Milliseconds 100
}
