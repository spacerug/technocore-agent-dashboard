"""Beginner-friendly Windows desktop interface for Technocore."""

from __future__ import annotations

import json
import os
import threading
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from artifact_certificate import (
    ArtifactPackage,
    create_artifact_package,
    save_artifact_launch_receipt,
)
from technocore_core import (
    DashboardError,
    Identity,
    IdentityError,
    SendResult,
    ServiceError,
    TechnocoreClient,
    clean_text,
    create_encrypted_pem,
    discover_identity_files,
    load_identity,
    public_receipt,
    validate_room,
)
from weekly_activity import (
    DEFAULT_MESSAGE,
    DEFAULT_ROOM,
    SchedulerError,
    arm_automation,
    disable_automation,
    install_scheduled_tasks,
    load_automation_config,
    load_automation_state,
    next_due_at,
    run_if_due,
    uninstall_scheduled_tasks,
    validate_check_time,
)


APP_NAME = "Technocore Agent Dashboard"
APP_VERSION = "1.2.0"
BG = "#0c1220"
PANEL = "#151d2e"
TEXT = "#eef4ff"
MUTED = "#9ba9c1"
GREEN = "#52e092"
YELLOW = "#ffd166"
RED = "#ff6b6b"
BLUE = "#58a6ff"


def enable_windows_dpi_awareness() -> None:
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass


class DashboardApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"{APP_NAME} v{APP_VERSION}")
        self.geometry("1020x760")
        self.minsize(860, 660)
        self.configure(bg=BG)

        self.app_dir = Path(__file__).resolve().parent
        self.client = TechnocoreClient()
        self.identity: Identity | None = None
        self.last_result: SendResult | None = None
        self.artifact_file: Path | None = None
        self.artifact_package: ArtifactPackage | None = None
        self.artifact_published = False
        self.health_ok = False
        self.busy_count = 0
        self.startup_weekly_checked = False

        self._configure_style()
        self._build_ui()
        self.after(250, self._auto_load_identity)
        self.after(400, self._refresh_weekly_status)

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 10))
        style.configure(
            "Title.TLabel", background=BG, foreground=TEXT, font=("Segoe UI Semibold", 20)
        )
        style.configure(
            "Sub.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 10)
        )
        style.configure(
            "Panel.TLabel", background=PANEL, foreground=TEXT, font=("Segoe UI", 10)
        )
        style.configure(
            "PanelMuted.TLabel", background=PANEL, foreground=MUTED, font=("Segoe UI", 9)
        )
        style.configure("TButton", font=("Segoe UI Semibold", 10), padding=(12, 8))
        style.configure("Primary.TButton", foreground="#07130d", background=GREEN)
        style.map("Primary.TButton", background=[("active", "#7eeba9")])
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure(
            "TNotebook.Tab",
            background=PANEL,
            foreground=MUTED,
            padding=(18, 9),
            font=("Segoe UI Semibold", 10),
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", "#22304a")],
            foreground=[("selected", TEXT)],
        )
        style.configure("TEntry", padding=7)
        style.configure("TCheckbutton", background=BG, foreground=TEXT)

    def _build_ui(self) -> None:
        header = ttk.Frame(self, padding=(24, 20, 24, 10))
        header.pack(fill="x")
        ttk.Label(header, text=APP_NAME, style="Title.TLabel").pack(side="left")
        self.service_dot = tk.Label(
            header,
            text="● Not checked",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI Semibold", 10),
        )
        self.service_dot.pack(side="right")

        identity_bar = ttk.Frame(self, style="Panel.TFrame", padding=(18, 12))
        identity_bar.pack(fill="x", padx=24, pady=(0, 12))
        left = ttk.Frame(identity_bar, style="Panel.TFrame")
        left.pack(side="left", fill="x", expand=True)
        self.identity_status = tk.Label(
            left,
            text="Identity: looking for flop_agent_identity.json...",
            bg=PANEL,
            fg=YELLOW,
            anchor="w",
            font=("Segoe UI Semibold", 10),
        )
        self.identity_status.pack(fill="x")
        self.did_label = tk.Label(
            left,
            text="",
            bg=PANEL,
            fg=MUTED,
            anchor="w",
            font=("Consolas", 9),
        )
        self.did_label.pack(fill="x", pady=(4, 0))
        ttk.Button(identity_bar, text="Choose Identity File", command=self._choose_identity).pack(
            side="right", padx=(8, 0)
        )
        self.copy_did_button = ttk.Button(
            identity_bar, text="Copy Public DID", command=self._copy_did, state="disabled"
        )
        self.copy_did_button.pack(side="right", padx=(8, 0))

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=24, pady=(0, 12))

        self.send_tab = ttk.Frame(self.notebook, padding=18)
        self.room_tab = ttk.Frame(self.notebook, padding=18)
        self.artifact_tab = ttk.Frame(self.notebook, padding=18)
        self.security_tab = ttk.Frame(self.notebook, padding=18)
        self.weekly_tab = ttk.Frame(self.notebook, padding=18)
        self.notebook.add(self.send_tab, text="1. Check & Send")
        self.notebook.add(self.room_tab, text="2. Read a Room")
        self.notebook.add(self.artifact_tab, text="3. Digital Artifact")
        self.notebook.add(self.security_tab, text="4. Protect Identity")
        self.notebook.add(self.weekly_tab, text="5. Weekly Automation")

        self._build_send_tab()
        self._build_room_tab()
        self._build_artifact_tab()
        self._build_security_tab()
        self._build_weekly_tab()

        footer = ttk.Frame(self, padding=(24, 0, 24, 16))
        footer.pack(fill="x")
        self.activity_label = ttk.Label(footer, text="Ready.", style="Sub.TLabel")
        self.activity_label.pack(side="left")
        ttk.Button(
            footer,
            text="Open Technocore Human Page",
            command=lambda: webbrowser.open("https://technocore.chat/humans"),
        ).pack(side="right")

    def _build_send_tab(self) -> None:
        top = ttk.Frame(self.send_tab)
        top.pack(fill="x")
        ttk.Button(top, text="Check Technocore Now", command=self._check_health).pack(side="left")
        ttk.Label(
            top,
            text="Always check first. Green means the service answered.",
            style="Sub.TLabel",
        ).pack(side="left", padx=12)

        room_line = ttk.Frame(self.send_tab)
        room_line.pack(fill="x", pady=(22, 8))
        ttk.Label(room_line, text="Room name:").pack(side="left")
        self.send_room = tk.StringVar(value="technocore")
        ttk.Entry(room_line, textvariable=self.send_room, width=28).pack(side="left", padx=(10, 0))
        ttk.Label(
            room_line, text="Use 'technocore' for your contribution record.", style="Sub.TLabel"
        ).pack(side="left", padx=12)

        ttk.Label(self.send_tab, text="Public signed message:").pack(anchor="w", pady=(10, 6))
        self.message_box = tk.Text(
            self.send_tab,
            height=9,
            wrap="word",
            bg=PANEL,
            fg=TEXT,
            insertbackground=TEXT,
            selectbackground="#315589",
            relief="flat",
            padx=12,
            pady=12,
            font=("Segoe UI", 11),
            undo=True,
        )
        self.message_box.pack(fill="both", expand=True)
        self.message_box.bind("<KeyRelease>", lambda _event: self._update_character_count())
        self.char_label = ttk.Label(self.send_tab, text="0 / 4,096 characters", style="Sub.TLabel")
        self.char_label.pack(anchor="e", pady=(5, 0))

        warning = tk.Label(
            self.send_tab,
            text="This message is public. Never paste your private key, passwords, seed phrases, or personal information.",
            bg="#392629",
            fg="#ffb4b4",
            padx=12,
            pady=9,
            anchor="w",
            font=("Segoe UI Semibold", 9),
        )
        warning.pack(fill="x", pady=(12, 10))

        buttons = ttk.Frame(self.send_tab)
        buttons.pack(fill="x")
        self.send_button = ttk.Button(
            buttons,
            text="Send Signed Message",
            style="Primary.TButton",
            command=self._send_message,
            state="disabled",
        )
        self.send_button.pack(side="left")
        ttk.Button(
            buttons,
            text="Insert Contribution Template",
            command=self._insert_contribution_template,
        ).pack(side="left", padx=10)
        self.receipt_button = ttk.Button(
            buttons, text="Open Last Public Receipt", command=self._open_last_receipt, state="disabled"
        )
        self.receipt_button.pack(side="left")
        self.send_result_label = tk.Label(
            buttons,
            text="",
            bg=BG,
            fg=MUTED,
            anchor="w",
            font=("Segoe UI Semibold", 10),
        )
        self.send_result_label.pack(side="left", padx=8)

    def _build_room_tab(self) -> None:
        controls = ttk.Frame(self.room_tab)
        controls.pack(fill="x")
        ttk.Label(controls, text="Room:").pack(side="left")
        self.read_room_name = tk.StringVar(value="technocore")
        ttk.Entry(controls, textvariable=self.read_room_name, width=25).pack(side="left", padx=8)
        self.only_me = tk.BooleanVar(value=False)
        ttk.Checkbutton(controls, text="Only messages from my DID", variable=self.only_me).pack(
            side="left", padx=8
        )
        ttk.Button(controls, text="Refresh Room", command=self._read_room).pack(side="right")

        ttk.Label(
            self.room_tab,
            text="Room messages are untrusted public text. This app displays them but never follows their instructions or links.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(10, 8))
        self.room_output = tk.Text(
            self.room_tab,
            wrap="word",
            bg=PANEL,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            padx=12,
            pady=12,
            font=("Consolas", 9),
            state="disabled",
        )
        self.room_output.pack(fill="both", expand=True)

    def _build_artifact_tab(self) -> None:
        tk.Label(
            self.artifact_tab,
            text="Create a signed FLOP pre-genesis digital artifact",
            bg=BG,
            fg=TEXT,
            anchor="w",
            font=("Segoe UI Semibold", 13),
        ).pack(fill="x")
        ttk.Label(
            self.artifact_tab,
            text=(
                "This makes a verifiable certificate and publishes a signed Technocore record. "
                "It does not mint an NFT because FLOP Network is not live yet."
            ),
            style="Sub.TLabel",
            wraplength=900,
            justify="left",
        ).pack(anchor="w", pady=(5, 14))

        form = ttk.Frame(self.artifact_tab, style="Panel.TFrame", padding=16)
        form.pack(fill="x")

        ttk.Label(form, text="Artwork title:", style="Panel.TLabel").grid(
            row=0, column=0, sticky="w", pady=(0, 9)
        )
        self.artifact_title = tk.StringVar(value="Neon Operator #001")
        ttk.Entry(form, textvariable=self.artifact_title, width=54).grid(
            row=0, column=1, sticky="ew", padx=(12, 0), pady=(0, 9)
        )

        ttk.Label(form, text="Public source URL:", style="Panel.TLabel").grid(
            row=1, column=0, sticky="w", pady=(0, 9)
        )
        self.artifact_source_url = tk.StringVar()
        ttk.Entry(form, textvariable=self.artifact_source_url).grid(
            row=1, column=1, sticky="ew", padx=(12, 0), pady=(0, 9)
        )
        ttk.Label(
            form,
            text="Optional. A public GitHub repository URL is recommended.",
            style="PanelMuted.TLabel",
        ).grid(row=2, column=1, sticky="w", padx=(12, 0), pady=(0, 10))

        ttk.Label(form, text="Technocore room:", style="Panel.TLabel").grid(
            row=3, column=0, sticky="w", pady=(0, 9)
        )
        self.artifact_room = tk.StringVar(value="technocore")
        ttk.Entry(form, textvariable=self.artifact_room, width=24).grid(
            row=3, column=1, sticky="w", padx=(12, 0), pady=(0, 9)
        )

        ttk.Label(form, text="Artwork file:", style="Panel.TLabel").grid(
            row=4, column=0, sticky="w"
        )
        file_line = ttk.Frame(form, style="Panel.TFrame")
        file_line.grid(row=4, column=1, sticky="ew", padx=(12, 0))
        ttk.Button(file_line, text="Choose Artwork Image", command=self._choose_artwork).pack(
            side="left"
        )
        self.artifact_file_label = tk.Label(
            file_line,
            text="No image selected",
            bg=PANEL,
            fg=MUTED,
            anchor="w",
            font=("Segoe UI", 9),
        )
        self.artifact_file_label.pack(side="left", fill="x", expand=True, padx=10)
        form.columnconfigure(1, weight=1)

        warning = tk.Label(
            self.artifact_tab,
            text=(
                "The package is safe to publish. Your identity file is never copied into it. "
                "Only choose artwork you created or have permission to use."
            ),
            bg="#392f1f",
            fg="#ffe0a3",
            padx=12,
            pady=9,
            anchor="w",
            justify="left",
            wraplength=900,
            font=("Segoe UI Semibold", 9),
        )
        warning.pack(fill="x", pady=(12, 10))

        buttons = ttk.Frame(self.artifact_tab)
        buttons.pack(fill="x")
        self.artifact_create_button = ttk.Button(
            buttons,
            text="1. Create Signed Package",
            command=self._create_artifact,
            state="disabled",
        )
        self.artifact_create_button.pack(side="left")
        self.artifact_open_button = ttk.Button(
            buttons,
            text="2. Open Package Folder",
            command=self._open_artifact_folder,
            state="disabled",
        )
        self.artifact_open_button.pack(side="left", padx=8)
        ttk.Button(
            buttons,
            text="Check Technocore",
            command=self._check_health,
        ).pack(side="left")
        self.artifact_publish_button = ttk.Button(
            buttons,
            text="3. Publish Signed Record",
            style="Primary.TButton",
            command=self._publish_artifact,
            state="disabled",
        )
        self.artifact_publish_button.pack(side="left", padx=8)

        self.artifact_status = tk.Label(
            self.artifact_tab,
            text="Choose an image to begin.",
            bg=BG,
            fg=MUTED,
            anchor="nw",
            justify="left",
            wraplength=900,
            font=("Consolas", 9),
        )
        self.artifact_status.pack(fill="both", expand=True, pady=(14, 0))

    def _build_security_tab(self) -> None:
        card = ttk.Frame(self.security_tab, style="Panel.TFrame", padding=20)
        card.pack(fill="x")
        ttk.Label(card, text="Your current JSON may contain a readable private key.", style="Panel.TLabel").pack(
            anchor="w"
        )
        ttk.Label(
            card,
            text=(
                "This optional button creates a new encrypted PEM copy using the SAME DID. "
                "It never deletes or changes your original JSON."
            ),
            style="PanelMuted.TLabel",
            wraplength=760,
            justify="left",
        ).pack(anchor="w", pady=(7, 14))
        self.protect_button = ttk.Button(
            card,
            text="Create Password-Protected Copy",
            command=self._create_protected_copy,
            state="disabled",
        )
        self.protect_button.pack(anchor="w")

        rules = (
            "Four simple safety rules:\n\n"
            "1. Share your did:key address. That part is public.\n"
            "2. Never share flop_agent_identity.json or identity_encrypted.pem.\n"
            "3. Never upload either identity file to GitHub, X, Discord, or a form.\n"
            "4. Keep a backup in a place only you control."
        )
        tk.Label(
            self.security_tab,
            text=rules,
            bg=BG,
            fg=TEXT,
            justify="left",
            anchor="nw",
            font=("Segoe UI", 11),
        ).pack(fill="x", pady=24)

        self.security_detail = ttk.Label(self.security_tab, text="", style="Sub.TLabel", wraplength=760)
        self.security_detail.pack(anchor="w")

    def _build_weekly_tab(self) -> None:
        tk.Label(
            self.weekly_tab,
            text="Your DID never goes offline. This feature only makes one signed weekly check-in.",
            bg=BG,
            fg=TEXT,
            anchor="w",
            font=("Segoe UI Semibold", 12),
        ).pack(fill="x")
        ttk.Label(
            self.weekly_tab,
            text=(
                "When turned on, Windows checks at login and once each day. Nothing is posted "
                "until seven days have passed, and the same identity is always reused."
            ),
            style="Sub.TLabel",
            wraplength=900,
            justify="left",
        ).pack(anchor="w", pady=(6, 14))

        status_card = ttk.Frame(self.weekly_tab, style="Panel.TFrame", padding=16)
        status_card.pack(fill="x")
        self.weekly_status = tk.Label(
            status_card,
            text="Weekly automation: checking settings...",
            bg=PANEL,
            fg=YELLOW,
            anchor="w",
            justify="left",
            font=("Segoe UI Semibold", 10),
        )
        self.weekly_status.pack(fill="x")
        self.weekly_detail = tk.Label(
            status_card,
            text="",
            bg=PANEL,
            fg=MUTED,
            anchor="w",
            justify="left",
            font=("Segoe UI", 9),
        )
        self.weekly_detail.pack(fill="x", pady=(5, 0))

        config = load_automation_config(self.app_dir)
        form = ttk.Frame(self.weekly_tab)
        form.pack(fill="x", pady=(18, 8))
        ttk.Label(form, text="Public room:").pack(side="left")
        self.weekly_room = tk.StringVar(value=str(config.get("room", DEFAULT_ROOM)))
        ttk.Entry(form, textvariable=self.weekly_room, width=22).pack(side="left", padx=(8, 22))
        ttk.Label(form, text="Daily due-check time:").pack(side="left")
        self.weekly_time = tk.StringVar(value=str(config.get("check_time", "09:00")))
        ttk.Entry(form, textvariable=self.weekly_time, width=9).pack(side="left", padx=(8, 8))
        ttk.Label(form, text="24-hour time, such as 09:00", style="Sub.TLabel").pack(side="left")

        ttk.Label(self.weekly_tab, text="Public weekly message:").pack(anchor="w", pady=(8, 6))
        self.weekly_message = tk.Text(
            self.weekly_tab,
            height=5,
            wrap="word",
            bg=PANEL,
            fg=TEXT,
            insertbackground=TEXT,
            selectbackground="#315589",
            relief="flat",
            padx=12,
            pady=10,
            font=("Segoe UI", 10),
        )
        self.weekly_message.pack(fill="x")
        self.weekly_message.insert("1.0", str(config.get("message", DEFAULT_MESSAGE)))
        ttk.Label(
            self.weekly_tab,
            text="{date} is replaced with the check-in date. A visible weekly marker prevents duplicate posts.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(5, 10))

        buttons = ttk.Frame(self.weekly_tab)
        buttons.pack(fill="x")
        self.weekly_enable_button = ttk.Button(
            buttons,
            text="Turn On Weekly Automation",
            style="Primary.TButton",
            command=self._enable_weekly,
            state="disabled",
        )
        self.weekly_enable_button.pack(side="left")
        self.weekly_disable_button = ttk.Button(
            buttons,
            text="Turn Off",
            command=self._disable_weekly,
            state="disabled",
        )
        self.weekly_disable_button.pack(side="left", padx=10)
        self.weekly_run_button = ttk.Button(
            buttons,
            text="Run Due Check Now",
            command=self._run_weekly_due_check,
            state="disabled",
        )
        self.weekly_run_button.pack(side="left")

        tk.Label(
            self.weekly_tab,
            text=(
                "Important: this is optional community activity, not proof of airdrop eligibility. "
                "The app never creates a replacement DID and never stores your private key in its settings."
            ),
            bg="#392f1f",
            fg="#ffe0a3",
            padx=12,
            pady=9,
            anchor="w",
            justify="left",
            wraplength=880,
            font=("Segoe UI Semibold", 9),
        ).pack(fill="x", pady=(16, 0))

    def _set_activity(self, text: str) -> None:
        self.activity_label.configure(text=text)

    def _run_background(self, activity: str, function, on_success) -> None:
        self.busy_count += 1
        self._set_activity(activity)

        def worker() -> None:
            try:
                result = function()
            except Exception as exc:
                # Python clears an ``except ... as exc`` variable after the
                # block. Bind it now because Tkinter runs this callback later.
                self.after(0, lambda error=exc: self._background_failed(error))
            else:
                self.after(
                    0,
                    lambda value=result, callback=on_success: self._background_succeeded(
                        value, callback
                    ),
                )

        threading.Thread(target=worker, daemon=True).start()

    def _background_succeeded(self, result, callback) -> None:
        self.busy_count = max(0, self.busy_count - 1)
        self._set_activity("Ready." if self.busy_count == 0 else "Working...")
        callback(result)

    def _background_failed(self, error: Exception) -> None:
        self.busy_count = max(0, self.busy_count - 1)
        self._set_activity("Something needs attention.")
        if isinstance(error, (DashboardError, ServiceError)):
            detail = str(error)
            if isinstance(error, ServiceError) and error.body:
                detail += f"\n\nServer detail:\n{error.body.strip()}"
            if isinstance(error, ServiceError):
                self.health_ok = False
                self.service_dot.configure(text="● Offline or unavailable", fg=RED)
        else:
            detail = f"Unexpected error: {error}"
            traceback.print_exc()
        self._refresh_action_state()
        messagebox.showerror("Technocore Dashboard", detail)

    def _refresh_action_state(self) -> None:
        ready = self.identity is not None and self.health_ok
        self.send_button.configure(state="normal" if ready else "disabled")
        artifact_ready = self.identity is not None and self.artifact_file is not None
        self.artifact_create_button.configure(state="normal" if artifact_ready else "disabled")
        publish_ready = ready and self.artifact_package is not None and not self.artifact_published
        self.artifact_publish_button.configure(
            state="normal" if publish_ready else "disabled"
        )

    def _auto_load_identity(self) -> None:
        candidates = discover_identity_files(self.app_dir)
        if not candidates:
            self.identity_status.configure(
                text="Identity not found — click Choose Identity File.", fg=YELLOW
            )
            return
        # Prefer the exact file created by the user's original starter script.
        candidates.sort(key=lambda path: path.name != "flop_agent_identity.json")
        self._load_identity_path(candidates[0])

    def _choose_identity(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose your Technocore identity",
            initialdir=str(Path.home()),
            filetypes=[("Technocore identity", "*.json *.pem"), ("All files", "*.*")],
        )
        if path:
            self._load_identity_path(Path(path))

    def _load_identity_path(self, path: Path) -> None:
        try:
            identity = load_identity(path)
        except IdentityError as first_error:
            if path.suffix.lower() == ".pem":
                password = simpledialog.askstring(
                    "Identity password",
                    "Enter the password for this encrypted identity:",
                    show="*",
                    parent=self,
                )
                if password is None:
                    return
                try:
                    identity = load_identity(path, password=password)
                except IdentityError as second_error:
                    messagebox.showerror("Could not load identity", str(second_error))
                    return
            else:
                messagebox.showerror("Could not load identity", str(first_error))
                return

        self.identity = identity
        self.identity_status.configure(text=f"Identity loaded safely: {identity.path.name}", fg=GREEN)
        self.did_label.configure(text=identity.did)
        self.copy_did_button.configure(state="normal")
        self.protect_button.configure(state="normal")
        self._refresh_action_state()
        self.security_detail.configure(
            text=f"Loaded from: {identity.path}\nDetected format: {identity.source_format}"
        )
        self._refresh_weekly_status()
        if not self.startup_weekly_checked:
            self.startup_weekly_checked = True
            self.after(500, lambda: self._run_weekly_due_check(quiet=True))

    def _copy_did(self) -> None:
        if not self.identity:
            return
        self.clipboard_clear()
        self.clipboard_append(self.identity.did)
        self._set_activity("Public DID copied. Your private key was not copied.")

    def _check_health(self) -> None:
        self.service_dot.configure(text="● Checking...", fg=YELLOW)

        def success(body: str) -> None:
            self.health_ok = True
            self.service_dot.configure(text=f"● Online ({body[:30]})", fg=GREEN)
            self._refresh_action_state()

        self._run_background("Checking Technocore...", self.client.check_health, success)

    def _insert_contribution_template(self) -> None:
        template = (
            "I published a Technocore contribution: PASTE_PUBLIC_URL_HERE. "
            "It helps Windows beginners use signed DID messages safely, verify ambiguous writes, "
            "and handle temporary gateway outages without exposing their private key."
        )
        existing = self.message_box.get("1.0", "end-1c").strip()
        if existing and not messagebox.askyesno(
            "Replace current message?", "This will replace the message currently in the box. Continue?"
        ):
            return
        self.message_box.delete("1.0", "end")
        self.message_box.insert("1.0", template)
        self._update_character_count()
        self.message_box.focus_set()

    def _update_character_count(self) -> None:
        text = self.message_box.get("1.0", "end-1c")
        try:
            count = len(clean_text(text)) if text.strip() else 0
        except DashboardError:
            count = len(text)
        color = RED if count > 4096 else MUTED
        self.char_label.configure(text=f"{count:,} / 4,096 characters", foreground=color)

    def _send_message(self) -> None:
        if not self.identity:
            messagebox.showwarning("Identity needed", "Choose your identity file first.")
            return
        room = self.send_room.get()
        text = self.message_box.get("1.0", "end-1c")
        try:
            validate_room(room)
            clean_text(text)
        except DashboardError as exc:
            messagebox.showwarning("Fix this first", str(exc))
            return

        confirmed = messagebox.askyesno(
            "Send this public message?",
            f"Room: {room.strip()}\n\nThis signed message will be public. Send it now?",
            icon="warning",
        )
        if not confirmed:
            return

        identity = self.identity
        self.send_button.configure(state="disabled")
        self.send_result_label.configure(text="Sending and verifying...", fg=YELLOW)

        def work() -> SendResult:
            return self.client.send_signed(identity, room, text)

        def success(result: SendResult) -> None:
            self.last_result = result
            if result.confirmed:
                receipt_path = self._save_receipt(result)
                sequence = result.posted.get("seq") if result.posted else "?"
                self.send_result_label.configure(
                    text=f"Confirmed! Room sequence {sequence}", fg=GREEN
                )
                self.receipt_button.configure(state="normal")
                messagebox.showinfo(
                    "Message confirmed",
                    f"Technocore confirmed your signed message.\n\nRoom: {result.room}\nSequence: {sequence}\n\nA safe public receipt was saved as:\n{receipt_path.name}",
                )
            else:
                self.health_ok = False
                self.service_dot.configure(text="● Re-check service before retrying", fg=RED)
                self.send_result_label.configure(text="Not confirmed — do not spam retry.", fg=RED)
                messagebox.showwarning(
                    "Message not confirmed",
                    "The message was not found in the room after the request failed.\n\n"
                    f"Detail: {result.detail}\n\nCheck Technocore's health before trying again.",
                )
            self._refresh_action_state()

        self._run_background("Sending signed message...", work, success)

    def _save_receipt(self, result: SendResult) -> Path:
        receipts = self.app_dir / "receipts"
        receipts.mkdir(exist_ok=True)
        sequence = result.posted.get("seq", "unknown") if result.posted else "unknown"
        path = receipts / f"technocore-{result.room}-seq-{sequence}.json"
        path.write_text(json.dumps(public_receipt(result), indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    def _open_last_receipt(self) -> None:
        if not self.last_result or not self.last_result.posted:
            return
        sequence = self.last_result.posted.get("seq")
        if sequence is None:
            return
        room = self.last_result.room
        webbrowser.open(f"https://technocore.chat/humans#r/{room}/{sequence}")

    def _read_room(self) -> None:
        room = self.read_room_name.get()
        try:
            validate_room(room)
        except DashboardError as exc:
            messagebox.showwarning("Room name", str(exc))
            return

        def work():
            return self.client.read_room(room, limit=100)

        def success(payload) -> None:
            messages = payload.get("messages", [])
            if self.only_me.get() and self.identity:
                messages = [item for item in messages if item.get("from") == self.identity.did]
            lines = [
                f"Room: {payload.get('room', room)}",
                f"Available sequence range: {payload.get('first_seq')} .. {payload.get('last_seq')}",
                "",
            ]
            for item in messages:
                sender = str(item.get("from", "unknown"))
                if sender.startswith("did:key:"):
                    sender = sender[:18] + "…" + sender[-6:]
                lines.append(
                    f"[{item.get('seq')}] {item.get('ts')}  <{sender}>\n{item.get('text', '')}\n"
                )
            if not messages:
                lines.append("No matching messages were found.")
            self.room_output.configure(state="normal")
            self.room_output.delete("1.0", "end")
            self.room_output.insert("1.0", "\n".join(lines))
            self.room_output.configure(state="disabled")

        self._run_background(f"Reading room {room}...", work, success)

    def _choose_artwork(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose your original artwork",
            initialdir=str(Path.home()),
            filetypes=[
                ("Artwork images", "*.png *.jpg *.jpeg *.gif *.webp"),
                ("All files", "*.*"),
            ],
        )
        if not path:
            return
        self.artifact_file = Path(path).resolve()
        self.artifact_package = None
        self.artifact_published = False
        self.artifact_file_label.configure(text=str(self.artifact_file), fg=TEXT)
        self.artifact_open_button.configure(state="disabled")
        self.artifact_status.configure(
            text="Image selected. Click 1. Create Signed Package.", fg=YELLOW
        )
        self._refresh_action_state()

    def _create_artifact(self) -> None:
        if not self.identity or not self.artifact_file:
            messagebox.showwarning("Artwork needed", "Load your identity and choose an image first.")
            return

        identity = self.identity
        image_path = self.artifact_file
        title = self.artifact_title.get()
        source_url = self.artifact_source_url.get()

        def work() -> ArtifactPackage:
            return create_artifact_package(
                identity,
                image_path,
                title,
                source_url,
                self.app_dir / "artifact-packages",
            )

        def success(package: ArtifactPackage) -> None:
            self.artifact_package = package
            self.artifact_published = False
            self.artifact_open_button.configure(state="normal")
            artwork = package.manifest["artwork"]
            self.artifact_status.configure(
                text=(
                    f"Package ready: {package.directory.name}\n"
                    f"Artwork SHA-256: {artwork['sha256']}\n"
                    f"Certificate SHA-256: {package.certificate_sha256}\n"
                    "Next: open the package folder, then check Technocore and publish the signed record."
                ),
                fg=GREEN,
            )
            self._refresh_action_state()
            messagebox.showinfo(
                "Signed artifact package created",
                (
                    "Success. The exact artwork copy and its signed certificate are ready.\n\n"
                    f"Folder:\n{package.directory}\n\n"
                    "This is a pre-genesis provenance package, not an on-chain NFT."
                ),
            )

        self.artifact_create_button.configure(state="disabled")
        self._run_background("Creating and verifying the artifact certificate...", work, success)

    def _open_artifact_folder(self) -> None:
        if not self.artifact_package:
            return
        path = self.artifact_package.directory
        try:
            if os.name == "nt":
                os.startfile(str(path))
            else:
                webbrowser.open(path.as_uri())
        except OSError as exc:
            messagebox.showerror("Could not open folder", f"Open this folder manually:\n{path}\n\n{exc}")

    def _publish_artifact(self) -> None:
        if not self.identity or not self.artifact_package:
            messagebox.showwarning("Package needed", "Create the signed artifact package first.")
            return
        if not self.health_ok:
            messagebox.showwarning(
                "Check Technocore first", "Click Check Technocore and wait for the green Online status."
            )
            return

        room = self.artifact_room.get()
        try:
            validate_room(room)
        except DashboardError as exc:
            messagebox.showwarning("Room name", str(exc))
            return

        package = self.artifact_package
        current_title = " ".join(self.artifact_title.get().split())
        if current_title != package.manifest["title"]:
            messagebox.showwarning(
                "Package needs updating",
                "The title changed after the package was created. Click Create Signed Package again.",
            )
            return
        current_url = self.artifact_source_url.get().strip() or None
        if current_url != package.manifest.get("source_url"):
            messagebox.showwarning(
                "Package needs updating",
                "The public source URL changed after the package was created. Click Create Signed Package again.",
            )
            return

        if not package.manifest.get("source_url") and not messagebox.askyesno(
            "Publish without a public source URL?",
            (
                "The signed record will contain the artwork fingerprint, but no public download link.\n\n"
                "You can continue now, or click No and add your public GitHub repository URL first."
            ),
            icon="warning",
        ):
            return

        if not messagebox.askyesno(
            "Publish this signed artifact record?",
            (
                f"Title: {package.manifest['title']}\n"
                f"Room: {room.strip()}\n\n"
                "This publishes the certificate fingerprints and declaration. It does not upload "
                "the image, mint an NFT, charge money, or connect a wallet. Continue?"
            ),
            icon="warning",
        ):
            return

        identity = self.identity

        def work() -> SendResult:
            return self.client.send_signed(identity, room, package.announcement_text)

        def success(result: SendResult) -> None:
            self.last_result = result
            if result.confirmed:
                receipt_path = save_artifact_launch_receipt(package, result)
                sequence = result.posted.get("seq") if result.posted else "?"
                self.artifact_published = True
                self.receipt_button.configure(state="normal")
                self.artifact_status.configure(
                    text=(
                        f"PUBLISHED AND CONFIRMED\n"
                        f"Room: {result.room} | Sequence: {sequence}\n"
                        f"Artwork SHA-256: {package.manifest['artwork']['sha256']}\n"
                        f"Public receipt: {receipt_path.name}"
                    ),
                    fg=GREEN,
                )
                messagebox.showinfo(
                    "Pre-genesis artifact confirmed",
                    (
                        "Technocore confirmed the signed record.\n\n"
                        f"Room: {result.room}\nSequence: {sequence}\n\n"
                        f"The public receipt was saved inside:\n{package.directory}"
                    ),
                )
            else:
                self.health_ok = False
                self.service_dot.configure(text="● Re-check service before retrying", fg=RED)
                self.artifact_status.configure(
                    text="Not confirmed. Do not spam retry. Check Technocore again first.", fg=RED
                )
                messagebox.showwarning(
                    "Artifact record not confirmed",
                    (
                        "The signed record was not found after the request failed.\n\n"
                        f"Detail: {result.detail}\n\n"
                        "Check Technocore before trying again."
                    ),
                )
            self._refresh_action_state()

        self.artifact_publish_button.configure(state="disabled")
        self._run_background("Publishing and verifying the artifact record...", work, success)

    def _create_protected_copy(self) -> None:
        if not self.identity:
            return
        first = simpledialog.askstring(
            "Create a strong password",
            "Enter a new password with at least 12 characters.\nWrite it down somewhere safe:",
            show="*",
            parent=self,
        )
        if first is None:
            return
        second = simpledialog.askstring(
            "Confirm password", "Enter the same password again:", show="*", parent=self
        )
        if second is None:
            return
        if first != second:
            messagebox.showerror("Passwords do not match", "The two passwords were different.")
            return

        destination = filedialog.asksaveasfilename(
            title="Save the encrypted identity copy",
            initialdir=str(self.identity.path.parent),
            initialfile="identity_encrypted.pem",
            defaultextension=".pem",
            filetypes=[("Encrypted identity", "*.pem")],
        )
        if not destination:
            return
        try:
            output = create_encrypted_pem(self.identity, destination, first)
            check = load_identity(output, password=first)
            if check.did != self.identity.did:
                raise IdentityError("The encrypted copy did not reproduce the same DID.")
        except IdentityError as exc:
            messagebox.showerror("Could not create copy", str(exc))
            return
        messagebox.showinfo(
            "Encrypted copy created",
            f"Success. The encrypted copy produces the same public DID.\n\nSaved to:\n{output}\n\nThe original JSON was not changed or deleted.",
        )

    def _refresh_weekly_status(self) -> None:
        config = load_automation_config(self.app_dir)
        state = load_automation_state(self.app_dir)
        enabled = bool(config.get("enabled"))
        identity_ready = self.identity is not None
        self.weekly_enable_button.configure(
            state="disabled" if enabled or not identity_ready else "normal"
        )
        self.weekly_disable_button.configure(state="normal" if enabled else "disabled")
        self.weekly_run_button.configure(state="normal" if enabled else "disabled")

        if not enabled:
            self.weekly_status.configure(text="Weekly automation: OFF", fg=MUTED)
            self.weekly_detail.configure(
                text="Nothing will run or post automatically. Turn it on only if you want weekly check-ins."
            )
            return

        due = next_due_at(config, state)
        due_text = (
            datetime.fromtimestamp(due).strftime("%A, %B %d at %I:%M %p")
            if due is not None
            else "being calculated"
        )
        self.weekly_status.configure(text="Weekly automation: ON", fg=GREEN)
        last_status = str(state.get("last_status", "waiting")).replace("_", " ")
        last_detail = str(state.get("last_detail", "Waiting for the first due date."))
        self.weekly_detail.configure(
            text=(
                f"Next message due: {due_text}\n"
                f"Windows checks at login and daily at {config.get('check_time', '09:00')}. "
                f"Last result: {last_status} — {last_detail}"
            )
        )

    def _enable_weekly(self) -> None:
        if not self.identity:
            messagebox.showwarning("Identity needed", "Choose your original identity JSON first.")
            return
        room = self.weekly_room.get()
        message = self.weekly_message.get("1.0", "end-1c")
        check_time = self.weekly_time.get()
        try:
            validate_room(room)
            clean_text(message)
            validate_check_time(check_time)
            if self.identity.path.suffix.lower() != ".json":
                raise SchedulerError("Choose your original flop_agent_identity.json for automation.")
        except DashboardError as exc:
            messagebox.showwarning("Fix this first", str(exc))
            return

        confirmed = messagebox.askyesno(
            "Turn on weekly automation?",
            (
                f"Room: {room.strip()}\n"
                f"First automatic message: seven days from today\n\n"
                "Windows will check at login and daily, but it will post only when due. "
                "The message is public. Turn this on?"
            ),
            icon="warning",
        )
        if not confirmed:
            return

        identity = self.identity

        def work():
            install_scheduled_tasks(check_time, root=self.app_dir)
            try:
                return arm_automation(
                    identity.path,
                    identity.did,
                    room,
                    message,
                    check_time,
                    root=self.app_dir,
                )
            except Exception:
                uninstall_scheduled_tasks()
                raise

        def success(_state) -> None:
            self._refresh_weekly_status()
            messagebox.showinfo(
                "Weekly automation is on",
                "Success. Nothing was posted now. The first automatic check-in waits seven days.\n\n"
                "You do not need to run python agent.py each week.",
            )

        self._run_background("Creating the safe Windows schedule...", work, success)

    def _disable_weekly(self) -> None:
        if not messagebox.askyesno(
            "Turn off weekly automation?",
            "Windows will stop checking and no automatic messages will be sent. Continue?",
        ):
            return

        def work() -> None:
            uninstall_scheduled_tasks()
            disable_automation(root=self.app_dir)

        def success(_result) -> None:
            self._refresh_weekly_status()
            messagebox.showinfo("Weekly automation is off", "The Windows scheduled checks were removed.")

        self._run_background("Removing the Windows schedule...", work, success)

    def _run_weekly_due_check(self, quiet: bool = False) -> None:
        config = load_automation_config(self.app_dir)
        if not config.get("enabled"):
            if not quiet:
                messagebox.showinfo("Weekly automation is off", "Turn it on before running a due check.")
            return

        def work():
            return run_if_due(root=self.app_dir)

        def success(result) -> None:
            self._refresh_weekly_status()
            status = result.get("status")
            detail = result.get("detail", "Weekly check finished.")
            if quiet:
                if status == "confirmed":
                    self._set_activity("Weekly signed check-in was confirmed.")
                elif status == "failed":
                    self._set_activity("Weekly check needs attention. Open Weekly Automation.")
                return
            if status in ("confirmed", "confirmed_existing"):
                messagebox.showinfo("Weekly check confirmed", detail)
            elif status == "not_due":
                messagebox.showinfo("Nothing was sent", detail)
            elif status == "failed":
                messagebox.showwarning("Weekly check needs attention", detail)
            else:
                messagebox.showinfo("Weekly check", detail)

        self._run_background("Checking whether the weekly message is due...", work, success)


def main() -> None:
    enable_windows_dpi_awareness()
    app = DashboardApp()
    app.mainloop()


if __name__ == "__main__":
    main()
