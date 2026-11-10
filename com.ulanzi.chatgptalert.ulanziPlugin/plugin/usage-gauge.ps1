$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$model = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$image = New-Object System.Drawing.Bitmap(196, 196)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(13, 19, 29))
$disposables = New-Object System.Collections.Generic.List[System.IDisposable]

function Draw-Text($text, $size, $x, $y, $color, $bold = $false) {
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = New-Object System.Drawing.Font('Malgun Gothic', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color))
    $disposables.Add($font)
    $disposables.Add($brush)
    $graphics.DrawString([string]$text, $font, $brush, [single]$x, [single]$y)
}

function Draw-Bar($percent, $y) {
    $track = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(42, 52, 67))
    $color = if ($percent -ge 90) { '#FF6B6B' } elseif ($percent -ge 70) { '#FFCA66' } else { '#54D8BD' }
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color))
    $disposables.Add($track)
    $disposables.Add($fill)
    $graphics.FillRectangle($track, 14, [single]$y, 168, 12)
    if ($null -ne $percent -and $percent -gt 0) {
        $graphics.FillRectangle($fill, 14, [single]$y, [single](168 * $percent / 100), 12)
    }
}

try {
    Draw-Text 'ChatGPT 사용량' 17 12 10 '#F1F5F9' $true
    if ($model.status -eq 'ready' -and $model.rows.Count -gt 0) {
        if ($model.rows.Count -eq 1) {
            $row = $model.rows[0]
            Draw-Text $row.label 14 14 45 '#9BAEC5'
            $value = if ($null -eq $row.percent) { '--%' } else { [string]$row.percent + '%' }
            Draw-Text $value 47 12 65 '#FFFFFF' $true
            Draw-Text '사용' 13 142 101 '#9BAEC5'
            Draw-Bar $row.percent 128
            Draw-Text $row.reset 12 12 149 '#BAC9DA'
        } else {
            for ($index = 0; $index -lt [Math]::Min(2, $model.rows.Count); $index++) {
                $row = $model.rows[$index]
                $y = 42 + $index * 65
                Draw-Text $row.label 13 14 $y '#9BAEC5'
                $value = if ($null -eq $row.percent) { '--%' } else { [string]$row.percent + '%' }
                Draw-Text $value 23 123 ($y - 4) '#FFFFFF' $true
                Draw-Bar $row.percent ($y + 25)
                Draw-Text $row.reset 10 12 ($y + 39) '#BAC9DA'
            }
        }
    } else {
        $label = if ($model.status -eq 'loading') { '불러오는 중' } else { '확인 불가' }
        $detail = if ($model.status -eq 'loading') { '잠시 기다려 주세요' } else { '앱 로그인·연결 확인' }
        Draw-Text $label 25 14 66 '#FFFFFF' $true
        Draw-Text $detail 13 14 108 '#9BAEC5'
    }
    Draw-Text '버튼: 새로고침 · 1분 갱신' 10 12 177 '#7F93AC'
    $stream = New-Object System.IO.MemoryStream
    $disposables.Add($stream)
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Write([Convert]::ToBase64String($stream.ToArray()))
} finally {
    foreach ($item in $disposables) { $item.Dispose() }
    $graphics.Dispose()
    $image.Dispose()
}
