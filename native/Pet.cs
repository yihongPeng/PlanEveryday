using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class PetMath {
    internal static bool IsDrag(Point start, Point current, float scale) {
        double dx = (double)current.X - start.X, dy = (double)current.Y - start.Y;
        return dx * dx + dy * dy > 36 * scale * scale;
    }
    internal static Point Clamp(Point point, Size size, Rectangle area) {
        return new Point(Math.Max(area.Left, Math.Min(point.X, area.Right - size.Width)), Math.Max(area.Top, Math.Min(point.Y, area.Bottom - size.Height)));
    }
}

internal static class PetTests {
    internal static void Run() {
        if (PetMath.IsDrag(new Point(10, 10), new Point(16, 10), 1f)) throw new Exception("Six logical pixels is still a click");
        if (!PetMath.IsDrag(new Point(10, 10), new Point(17, 10), 1f)) throw new Exception("Beyond threshold is a drag");
        if (PetMath.IsDrag(new Point(0, 0), new Point(12, 0), 2f)) throw new Exception("DPI-aware threshold");
        if (!PetMath.IsDrag(new Point(0, 0), new Point(9, 9), 2f)) throw new Exception("Diagonal distance threshold");
        Rectangle work = new Rectangle(-1920, 0, 1920, 1040);
        if (PetMath.Clamp(new Point(-2000, 1200), new Size(116,132), work) != new Point(-1920,908)) throw new Exception("Negative monitor boundary");
        if (PetMath.Clamp(new Point(4000, -5), new Size(116,132), new Rectangle(0,0,1920,1040)) != new Point(1804,0)) throw new Exception("Removed monitor recovery");
        Console.WriteLine("{\"type\":\"self-test\",\"passed\":6}");
    }
}
internal static class Program {
    internal static void Send(string json) {
        try { lock (Console.Out) { Console.WriteLine(json); Console.Out.Flush(); } }
        catch (System.IO.IOException) { }
    }
    [STAThread] private static void Main(string[] args) {
        // GUI-subsystem processes have redirected handles but no console code page.
        // Avoid Console.InputEncoding, which calls SetConsoleCP and fails without a console.
        Console.SetIn(new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        if (Array.IndexOf(args, "--self-test") >= 0) { PetTests.Run(); return; }
        try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { Native.SetProcessDPIAware(); }
        int x = 80, y = 100;
        for (int i = 0; i + 1 < args.Length; i++) {
            int value;
            if (!int.TryParse(args[i + 1], out value)) continue;
            if (args[i] == "--x") x = value;
            if (args[i] == "--y") y = value;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (PetForm form = new PetForm(new Point(x, y))) Application.Run(form);
    }
}

internal sealed class PetForm : Form {
    private float scale = 1;
    private bool pressed, dragged, closing;
    private Point pressCursor, pressOrigin;
    private int unread, done = -1;
    private bool celebrating;
    private readonly System.Windows.Forms.Timer celebration = new System.Windows.Forms.Timer();
    private readonly ContextMenuStrip menu = new ContextMenuStrip();
    private readonly ToolTip hint = new ToolTip();

    internal PetForm(Point point) {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.None;
        Location = point;
        ClientSize = new Size(116, 132);
        TopMost = true;
        Text = "芽芽桌宠";
        AccessibleName = "芽芽桌宠，点击打开计划，拖动调整位置";
        Cursor = Cursors.Hand;
        menu.Font = new Font("Microsoft YaHei UI", 10f);
        menu.Items.Add("打开计划", null, delegate { Program.Send("{\"type\":\"open\"}"); });
        menu.Items.Add("隐藏桌宠", null, delegate { Hide(); Program.Send("{\"type\":\"hide\"}"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出应用（退出后不再提醒）", null, delegate { Program.Send("{\"type\":\"quit\"}"); });
        hint.SetToolTip(this, "点击打开芽芽计划 · 拖动挪位置 · 右键更多");
        celebration.Interval = 1600;
        celebration.Tick += delegate { celebration.Stop(); celebrating = false; RenderPet(); };
        SystemEvents.DisplaySettingsChanged += DisplayChanged;
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00080000 | 0x00000080; return cp; }
    }
    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        // Wait for the parent's persisted visibility setting before presenting pixels.
        Hide();
        RefreshScale();
        Constrain(true);
        RenderPet();
        Program.Send("{\"type\":\"ready\"}");
        Thread reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();
    }
    private void ReadCommands() {
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                string command = line;
                if (closing) return;
                BeginInvoke((MethodInvoker)delegate { ApplyCommand(command); });
            }
        } catch (System.IO.IOException) { }
          catch (InvalidOperationException) { return; }
        if (!closing) try { BeginInvoke((MethodInvoker)delegate { Close(); }); } catch (InvalidOperationException) { }
    }
    private void ApplyCommand(string command) {
        string[] parts = command.Split('|');
        if (parts[0] == "status") { Program.Send("{\"type\":\"status\",\"visible\":" + (Visible ? "true" : "false") + ",\"nativeVisible\":" + (Native.IsWindowVisible(Handle) ? "true" : "false") + ",\"handle\":" + Handle.ToInt64() + "}"); return; }
        if (parts[0] == "quit") { Close(); return; }
        int x, y;
        if (parts.Length == 3 && parts[0] == "position" && int.TryParse(parts[1], out x) && int.TryParse(parts[2], out y)) {
            Location = new Point(x, y); RefreshScale(); Constrain(false); RenderPet(); return;
        }
        int newUnread, newDone;
        if (parts.Length != 5 || parts[0] != "state" || !int.TryParse(parts[3], out newUnread) || !int.TryParse(parts[4], out newDone)) return;
        unread = Math.Max(0, newUnread);
        if (done >= 0 && newDone > done) { celebrating = true; celebration.Stop(); celebration.Start(); }
        done = newDone;
        TopMost = parts[2] == "1";
        if (parts[1] == "1") { if (!Visible) Show(); Constrain(false); RenderPet(); }
        else Hide();
    }
    private void RefreshScale() {
        uint dpi = 96;
        try { dpi = Native.GetDpiForWindow(Handle); } catch (EntryPointNotFoundException) { using (Graphics g = CreateGraphics()) dpi = (uint)g.DpiX; }
        scale = Math.Max(1f, dpi / 96f);
        ClientSize = new Size((int)Math.Round(116 * scale), (int)Math.Round(132 * scale));
    }
    private void Constrain(bool notify) {
        Point point = PetMath.Clamp(Location, Size, Screen.FromPoint(new Point(Left + Width / 2, Top + Height / 2)).WorkingArea);
        bool changed = point != Location;
        if (changed) Location = point;
        if (notify || changed) SendPosition();
    }
    private void SendPosition() { Program.Send("{\"type\":\"move\",\"x\":" + Left + ",\"y\":" + Top + "}"); }
    private void DisplayChanged(object sender, EventArgs e) {
        if (closing) return;
        try { BeginInvoke((MethodInvoker)delegate { RefreshScale(); Constrain(true); RenderPet(); }); } catch (InvalidOperationException) { }
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0021) { m.Result = new IntPtr(3); return; } // MA_NOACTIVATE
        if (m.Msg == 0x02E0) {
            Native.Rect suggested = (Native.Rect)Marshal.PtrToStructure(m.LParam, typeof(Native.Rect));
            scale = Math.Max(1f, (m.WParam.ToInt64() & 0xffff) / 96f);
            SetBounds(suggested.Left, suggested.Top, (int)Math.Round(116 * scale), (int)Math.Round(132 * scale));
            if (!pressed) Constrain(true);
            RenderPet(); m.Result = IntPtr.Zero; return;
        }
        base.WndProc(ref m);
    }
    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        pressed = true; dragged = false; pressCursor = Cursor.Position; pressOrigin = Location; Capture = true;
    }
    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if (!pressed) return;
        Point current = Cursor.Position;
        if (PetMath.IsDrag(pressCursor, current, scale)) dragged = true;
        if (dragged) Location = new Point(pressOrigin.X + current.X - pressCursor.X, pressOrigin.Y + current.Y - pressCursor.Y);
    }
    protected override void OnMouseUp(MouseEventArgs e) {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Right) { menu.Show(Cursor.Position); return; }
        if (e.Button != MouseButtons.Left || !pressed) return;
        bool wasDrag = dragged || PetMath.IsDrag(pressCursor, Cursor.Position, scale);
        pressed = false; Capture = false;
        if (wasDrag) Constrain(true);
        else Program.Send("{\"type\":\"open\"}");
    }
    protected override void OnMouseCaptureChanged(EventArgs e) { base.OnMouseCaptureChanged(e); if (!Capture) pressed = false; }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        closing = true;
        SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        celebration.Dispose(); menu.Dispose(); hint.Dispose();
        Program.Send("{\"type\":\"closed\"}");
        base.OnFormClosed(e);
    }
    private static Color C(string hex) { return ColorTranslator.FromHtml(hex); }
    private static GraphicsPath Rounded(float x, float y, float w, float h, float radius) {
        GraphicsPath path = new GraphicsPath(); float d = radius * 2;
        path.AddArc(x,y,d,d,180,90); path.AddArc(x+w-d,y,d,d,270,90);
        path.AddArc(x+w-d,y+h-d,d,d,0,90); path.AddArc(x,y+h-d,d,d,90,90); path.CloseFigure(); return path;
    }
    private void RenderPet() {
        if (!IsHandleCreated || closing) return;
        using (Bitmap bitmap = new Bitmap(Width, Height, PixelFormat.Format32bppPArgb)) {
            using (Graphics g = Graphics.FromImage(bitmap)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                g.ScaleTransform(scale, scale);
                using (GraphicsPath bubble = Rounded(3,2,110,26,12))
                using (Brush fill = new SolidBrush(C("#fffdf3")))
                using (Pen border = new Pen(C("#d7dfcb"),1)) { g.FillPath(fill,bubble); g.DrawPath(border,bubble); }
                string label = unread > 0 ? "有 " + (unread > 99 ? "99+" : unread.ToString()) + " 条提醒" : celebrating ? "完成啦，真好" : "今天也慢慢来";
                using (Font font = new Font("Microsoft YaHei UI",11,FontStyle.Regular,GraphicsUnit.Pixel))
                using (Brush text = new SolidBrush(C("#536b42")))
                using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    g.DrawString(label,font,text,new RectangleF(3,2,110,26),format);
                g.TranslateTransform(0,28);
                using (Brush shadow = new SolidBrush(Color.FromArgb(32,53,78,50))) g.FillEllipse(shadow,26,89,64,10);
                using (Pen stem = new Pen(C("#5f7a43"),4)) { stem.StartCap = stem.EndCap = LineCap.Round; g.DrawBezier(stem,58,30,58,23,56,19,53,16); }
                using (GraphicsPath leaf = new GraphicsPath())
                using (Brush green = new SolidBrush(C("#94b36f"))) {
                    leaf.AddBezier(57,23,36,26,32,7,36,4); leaf.AddBezier(36,4,52,3,60,10,57,23); g.FillPath(green,leaf);
                }
                using (GraphicsPath leaf = new GraphicsPath())
                using (Brush green = new SolidBrush(C("#678d4b"))) {
                    leaf.AddBezier(57,23,53,6,71,1,80,5); leaf.AddBezier(80,5,81,17,70,24,57,23); g.FillPath(green,leaf);
                }
                using (GraphicsPath body = new GraphicsPath())
                using (Brush cream = new SolidBrush(C("#faf1d7")))
                using (Pen outline = new Pen(C("#c9bd95"),1.5f)) {
                    body.AddBezier(21,64,19,40,35,26,58,27); body.AddBezier(58,27,83,27,98,43,96,65);
                    body.AddBezier(96,65,95,85,82,94,58,94); body.AddBezier(58,94,34,94,23,84,21,64);
                    g.FillPath(cream,body); g.DrawPath(outline,body);
                }
                using (Brush blush = new SolidBrush(Color.FromArgb(166,233,185,165))) { g.FillEllipse(blush,30,64,16,8); g.FillEllipse(blush,71,64,16,8); }
                using (Brush eyes = new SolidBrush(C("#465538")))
                using (Pen smile = new Pen(C(celebrating ? "#6a8f42" : "#465538"),2.5f)) {
                    smile.StartCap = smile.EndCap = LineCap.Round;
                    if (celebrating) { g.DrawArc(smile,40,56,7,7,190,160); g.DrawArc(smile,70,56,7,7,190,160); }
                    else { g.FillEllipse(eyes,40.2f,55,5.6f,8); g.FillEllipse(eyes,70.2f,55,5.6f,8); }
                    g.DrawBezier(smile,52,68,56,72,60,72,64,68);
                }
                using (Pen arms = new Pen(C("#c9bd95"),2)) { arms.StartCap = arms.EndCap = LineCap.Round; g.DrawBezier(arms,27,78,18,78,14,75,18,68); g.DrawBezier(arms,89,78,99,78,103,75,99,68); }
                if (unread > 0) using (Brush badge = new SolidBrush(C("#b26a45"))) using (Pen edge = new Pen(C("#fff5dd"),2)) { g.FillEllipse(badge,88,15,15,15); g.DrawEllipse(edge,88,15,15,15); }
            }
            Native.SetBitmap(Handle, bitmap, Location);
        }
    }
}

internal static class Native {
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, Pack=1)] private struct Blend { internal byte Op, Flags, Alpha, Format; }
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr screen, ref Point position, ref Size size, IntPtr source, ref Point origin, int key, ref Blend blend, int flags);
    internal static void SetBitmap(IntPtr window, Bitmap bitmap, Point position) {
        IntPtr screen = GetDC(IntPtr.Zero), dc = IntPtr.Zero, handle = IntPtr.Zero, previous = IntPtr.Zero;
        try {
            dc = CreateCompatibleDC(screen); handle = bitmap.GetHbitmap(Color.FromArgb(0)); previous = SelectObject(dc,handle);
            Point origin = Point.Empty; Size size = bitmap.Size; Blend blend = new Blend { Op=0, Flags=0, Alpha=255, Format=1 };
            if (!UpdateLayeredWindow(window,screen,ref position,ref size,dc,ref origin,0,ref blend,2))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            if (previous != IntPtr.Zero) SelectObject(dc,previous);
            if (handle != IntPtr.Zero) DeleteObject(handle);
            if (dc != IntPtr.Zero) DeleteDC(dc);
            ReleaseDC(IntPtr.Zero,screen);
        }
    }
}
