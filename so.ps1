# Bezobidnyi rozygrysh: kartinka na ves ekran + zvuk odin raz. Zakryt: Esc, klik myshyu ili Alt+F4; sam zakroetsya cherez 20 sekund.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, PresentationCore
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$img = [System.Drawing.Image]::FromFile((Join-Path $dir 'eye.jpg'))

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.WindowState = 'Maximized'
$form.BackColor = [System.Drawing.Color]::Black
$form.TopMost = $true
$form.KeyPreview = $true

$pb = New-Object System.Windows.Forms.PictureBox
$pb.Dock = 'Fill'
$pb.SizeMode = 'Zoom'
$pb.Image = $img
$pb.BackColor = [System.Drawing.Color]::Black
$form.Controls.Add($pb)

$form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $form.Close() } })
$pb.Add_Click({ $form.Close() })

$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([Uri](Join-Path $dir 'hacked.mp3'))
$player.Play()

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 20000
$timer.Add_Tick({ $form.Close() })
$timer.Start()

$form.Add_FormClosed({ $timer.Stop(); $player.Stop(); $player.Close() })
[void]$form.ShowDialog()