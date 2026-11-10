@echo off
rem Script di installazione di Lack per Windows

echo Creazione directory di installazione...
if not exist "%LOCALAPPDATA%\Programs\Lack" mkdir "%LOCALAPPDATA%\Programs\Lack"

echo Esecuzione della build...
call npm install
call npm run build

echo Verifica dell'esecuzione della build...
if not exist "dist\win-unpacked\Lack.exe" (
    echo Errore: file eseguibile non trovato in dist\win-unpacked\Lack.exe
    exit /b 1
)

echo Copia dell'applicazione nella directory di installazione...
xcopy /s /y "dist\win-unpacked\*" "%LOCALAPPDATA%\Programs\Lack\"
copy /y "build\lack.ico" "%LOCALAPPDATA%\Programs\Lack\lack.ico"

echo Verifica che l'applicazione sia stata copiata correttamente...
if not exist "%LOCALAPPDATA%\Programs\Lack\Lack.exe" (
    echo Errore: L'applicazione non è stata copiata correttamente nella directory di installazione.
    exit /b 1
)

echo Creazione del collegamento sul desktop...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Lack.lnk'); $s.TargetPath = '%LOCALAPPDATA%\Programs\Lack\Lack.exe'; $s.IconLocation = '%LOCALAPPDATA%\Programs\Lack\lack.ico'; $s.Save()"

echo Creazione del collegamento nel menu Start...
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('StartMenu') + '\Programs\Lack.lnk'); $s.TargetPath = '%LOCALAPPDATA%\Programs\Lack\Lack.exe'; $s.IconLocation = '%LOCALAPPDATA%\Programs\Lack\lack.ico'; $s.Save()"

echo Associazione dell'estensione .tex a Lack...
reg add "HKCU\Software\Classes\.tex" /ve /d "LaTeXFile" /f
reg add "HKCU\Software\Classes\LaTeXFile" /ve /d "Documento LaTeX" /f
reg add "HKCU\Software\Classes\LaTeXFile\DefaultIcon" /ve /d "%LOCALAPPDATA%\Programs\Lack\lack.ico" /f
reg add "HKCU\Software\Classes\LaTeXFile\shell\open\command" /ve /d "\"%LOCALAPPDATA%\Programs\Lack\Lack.exe\" \"%%1\"" /f

echo Lack è stato installato correttamente.
echo Per eseguire Lack, cerca "Lack" nel menu Start o usa il collegamento sul desktop.
pause
