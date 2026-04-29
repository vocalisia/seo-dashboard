# Migration Vercel → Local

## Ce qui a changé
- `vercel.json` → auto-deploy GitHub désactivé (`git.deploymentEnabled: false`)
- Crons Vercel supprimés (étaient: 7 jobs)
- Nouveau script `scripts/register-local-crons.ps1` → recrée les 7 crons en tâches Windows

## Setup en 3 étapes

### 1. Auto-start dev server au login (déjà fait)
```powershell
.\scripts\register-seo-dashboard-autostart.ps1
```
→ tâche `VocalisSeoDashboardDev` lance `npm run dev` à chaque ouverture session.

### 2. Crons locaux
```powershell
cd C:\Users\cohen.000\seo-dashboard
.\scripts\register-local-crons.ps1
```
→ crée 7 tâches `Vocalis_Seo_*` qui curl localhost:3001.

### 3. Finaliser côté Vercel (manuel)
Va sur https://vercel.com/vocalispro-1409/seo-dashboard → Settings →
- soit **Pause Deployment** (garde l'URL en cas de besoin)
- soit **Delete Project** (supprime tout)

Le push GitHub ne triggera plus de deploy grâce à `vercel.json.git.deploymentEnabled: false`.

## URL d'accès local
- Local PC: http://localhost:3001
- LAN (autres appareils même WiFi): `http://<IP_LOCALE>:3000` (trouve IP via `ipconfig`)
- Externe (mobile/extérieur): tunnel Cloudflare on-demand:
  ```powershell
  cloudflared tunnel --url http://localhost:3001
  ```

## Vérifier état des crons
```powershell
Get-ScheduledTask | Where-Object TaskName -like 'Vocalis_Seo_*' | Select TaskName, State, LastRunTime, NextRunTime
```

## Désinstaller les crons
```powershell
Get-ScheduledTask -TaskName 'Vocalis_Seo_*' | Unregister-ScheduledTask -Confirm:$false
```
