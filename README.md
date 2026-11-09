# Rossmann Watch

Daily scan of every rossmann.pl promotion → push to your phone when a watched product goes on sale, and again 2 days before the sale ends.

## Setup
1. Create a **public** GitHub repo (e.g. `rossmann-watch`) and upload all these files (keep the `.github/workflows` folder).
2. iPhone: install **ntfy** from the App Store → `+` → subscribe to a long random topic name, e.g. `aga-rossmann-8f3k2q9x`.
3. Repo → Settings → Secrets and variables → Actions → New secret: `NTFY_TOPIC` = that topic name.
4. Repo → Settings → Pages → Source: **GitHub Actions**.
5. Repo → Actions → `rossmann-check` → **Run workflow**.
6. Create a token: GitHub → Settings → Developer settings → Fine-grained tokens → only this repo → Permissions: **Contents: Read and write**.
7. Open `https://<user>.github.io/rossmann-watch/` on your phone → paste the token in ⚙︎ → Share → Add to Home Screen.

## Use
- **Moje**: paste a rossmann.pl product link (that exact product) or words like `nivea q10` (any promo item containing all words).
- **Promocje**: search everything on sale right now, tap ＋ to watch.
- Every change re-runs the check right away; otherwise it runs daily ~7:15.
