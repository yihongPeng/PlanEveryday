Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256,256
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = 'AntiAlias'
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#356247'))
$cream = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#F5EED8'))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#293D30'))
$leaf = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#B6C783'))
$g.FillEllipse($green, 0,0,256,256)
$g.FillEllipse($cream, 43,83,170,138)
$g.FillEllipse($leaf, 79,35,54,34)
$g.FillEllipse($leaf, 128,21,43,42)
$pen = New-Object System.Drawing.Pen $leaf,9
$g.DrawLine($pen,128,60,128,90)
$g.FillEllipse($dark,93,137,11,14)
$g.FillEllipse($dark,153,137,11,14)
$smile = New-Object System.Drawing.Pen $dark,5
$g.DrawArc($smile,117,151,26,16,0,180)
$bitmap.Save((Join-Path $assetDir 'app.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$png = [System.IO.File]::ReadAllBytes((Join-Path $assetDir 'app.png'))
$stream = [System.IO.File]::Create((Join-Path $assetDir 'app.ico'))
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $g.Dispose(); $bitmap.Dispose()
