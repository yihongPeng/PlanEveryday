using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// Starts NSIS only after its process environment points to D. NSIS's $TEMP is
// immutable, and changing it in customInit is already too late for plug-ins.
internal static class InstallerBootstrap {
    [STAThread]
    private static int Main(string[] args) {
        string staging = null;
        try {
            EnsureNoReparsePath(BuildInfo.TempRoot, false);
            EnsureNoReparsePath(BuildInfo.InstallRoot, true);
            EnsureNoReparsePath(BuildInfo.UpdateRoot, true);
            Directory.CreateDirectory(BuildInfo.TempRoot);
            string executable = Assembly.GetExecutingAssembly().Location;
            string installDirectory = BuildInfo.InstallRoot;
            string[] forwarded = args;

            // A normal uninstall must release the installed bootstrap before
            // NSIS removes it. Upgrades already invoke a copy outside INSTDIR.
            if (BuildInfo.IsUninstaller && !IsUnder(executable, BuildInfo.TempRoot)) {
                staging = Path.Combine(BuildInfo.TempRoot, "uninstall-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                string copy = Path.Combine(staging, "uninstall-bootstrap.exe");
                File.Copy(executable, copy);
                var launch = new ProcessStartInfo(copy, Join(args) + " --bootstrap-parent=" + Process.GetCurrentProcess().Id + " " + Quote("--bootstrap-installdir=" + installDirectory));
                Configure(launch, staging);
                Process.Start(launch);
                // The copied bootstrap owns this directory from here on.
                staging = null;
                return 0;
            }

            var clean = new System.Collections.Generic.List<string>();
            foreach (string argument in args) {
                if (argument.StartsWith("--bootstrap-parent=", StringComparison.Ordinal)) {
                    int parent;
                    if (Int32.TryParse(argument.Substring(19), out parent)) {
                        try { using (var process = Process.GetProcessById(parent)) { process.WaitForExit(10000); } } catch (ArgumentException) { }
                    }
                } else if (argument.StartsWith("--bootstrap-installdir=", StringComparison.Ordinal)) {
                    // Fixed target is compiled into both installer wrappers.
                } else if (BuildInfo.IsUninstaller && (argument.StartsWith("_?=", StringComparison.Ordinal) || argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))) {
                    // NSIS special path switches cannot redirect an uninstall.
                } else { clean.Add(argument); }
            }
            forwarded = clean.ToArray();
            staging = Path.Combine(BuildInfo.TempRoot, "run-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            string payload = Path.Combine(staging, "nsis-payload.exe");
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("nsis.payload")) {
                if (input == null) throw new InvalidDataException("安装包缺少内容。");
                using (var output = new FileStream(payload, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
            }
            string actual;
            using (var hash = SHA256.Create()) using (var stream = File.OpenRead(payload)) actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (!String.Equals(actual, BuildInfo.PayloadSha256, StringComparison.Ordinal)) throw new InvalidDataException("安装包校验失败，请重新下载安装包。现有程序和数据未更改。");

            string command = Join(forwarded);
            if (BuildInfo.IsUninstaller) command += " _?=" + installDirectory;
            var start = new ProcessStartInfo(payload, command);
            Configure(start, staging);
            start.EnvironmentVariables["PLAN_INSTALLER_SOURCE"] = executable;
            using (var child = Process.Start(start)) {
                child.WaitForExit();
                return child.ExitCode;
            }
        } catch (Exception error) {
            if (!Array.Exists(args, item => String.Equals(item, "/S", StringComparison.OrdinalIgnoreCase))) MessageBox.Show(error.Message + "\r\n请检查 D 盘是否可用且有足够空间。", "芽芽计划安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        } finally {
            // Only our unique, resolved staging child may be removed.
            if (staging != null && IsUnder(staging, BuildInfo.TempRoot)) { try { Directory.Delete(staging, true); } catch { } }
        }
    }
    private static bool IsUnder(string child, string parent) { return Path.GetFullPath(child).StartsWith(Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
    private static void EnsureNoReparsePath(string target, bool inspectContents) {
        string full = Path.GetFullPath(target);
        if (!full.StartsWith("D:\\", StringComparison.OrdinalIgnoreCase)) throw new IOException("安装目录必须位于 D 盘。");
        for (string current = full; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("安装目录及其上级目录不能使用链接或连接点：" + current);
        }
        if (inspectContents && Directory.Exists(full)) CheckContents(full);
    }
    private static void CheckContents(string directory) {
        foreach (string entry in Directory.EnumerateFileSystemEntries(directory)) {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("程序目录中存在链接，操作已停止：" + entry);
            if ((attributes & FileAttributes.Directory) != 0) CheckContents(entry);
        }
    }
    private static void Configure(ProcessStartInfo start, string workingDirectory) {
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = workingDirectory;
        start.EnvironmentVariables["TEMP"] = BuildInfo.TempRoot;
        start.EnvironmentVariables["TMP"] = BuildInfo.TempRoot;
    }
    private static string Join(string[] arguments) {
        var regular = new System.Collections.Generic.List<string>();
        string tail = null;
        foreach (string argument in arguments) {
            // NSIS requires these path switches to be unquoted and last.
            if (argument.StartsWith("_?=", StringComparison.Ordinal) || argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) tail = argument;
            else regular.Add(Quote(argument));
        }
        return String.Join(" ", regular.ToArray()) + (tail == null ? "" : " " + tail);
    }
    private static string Quote(string value) {
        // NSIS recognizes /S only as a bare switch, not as "/S".
        if (value.Length > 0 && Array.TrueForAll(value.ToCharArray(), character => !Char.IsWhiteSpace(character) && character != '"')) return value;
        // CommandLineToArgvW-compatible quoting, including trailing backslashes.
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
            else { result.Append('\\', slashes); result.Append(character); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
}
