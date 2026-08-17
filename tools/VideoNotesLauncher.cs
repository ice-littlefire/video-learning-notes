using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class VideoNotesLauncher
{
    [STAThread]
    private static void Main()
    {
        const string launcherPath = @"D:\demo_\jkl\learning-card-maker\启动视频笔记工具.bat";

        if (!File.Exists(launcherPath))
        {
            MessageBox.Show(
                "没有找到启动脚本：\n" + launcherPath,
                "视频笔记工具",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = launcherPath,
            WorkingDirectory = Path.GetDirectoryName(launcherPath) ?? Environment.CurrentDirectory,
            UseShellExecute = true
        });
    }
}
