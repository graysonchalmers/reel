# On-demand viewer (Stealth)

    cp ops/systemd/reel-viewer* ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user disable --now reel-viewer.service   # the old always-on unit, if present
    systemctl --user enable --now reel-viewer.socket

Port 18630 stays open (systemd holds it, ~0 RAM). The first request starts reel on 127.0.0.1:18631;
after 15 minutes with no open tab or request it shuts down. Claude can start it any time with
`systemctl --user start reel-viewer-proxy` or just a `curl` of the URL.
