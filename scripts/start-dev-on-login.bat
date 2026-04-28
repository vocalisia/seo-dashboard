@echo off
REM Lance le dashboard SEO en mode dev au demarrage de session Windows.
REM 1) Clic droit sur ce fichier > Creer un raccourci
REM 2) Win+R > shell:startup > coller le raccourci dans le dossier Demarrage
REM    (ou Planificateur de taches > Au demarrage / A la connexion)
REM Optionnel: dans les proprietes du raccourci, "Executer" = Reduit pour masquer la fenetre.

cd /d "%~dp0.."
where npm >nul 2>&1
if errorlevel 1 (
  echo npm introuvable dans le PATH. Installe Node.js ou ajoute npm au PATH.
  pause
  exit /b 1
)

echo [%date% %time%] Demarrage seo-dashboard (npm run dev)...
npm run dev
