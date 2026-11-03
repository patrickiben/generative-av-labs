"""Detail Forge Analog — local audio detail synthesis, honest by construction.

Drop a dull / band-limited track. Pick an arm:
  FLOOR  — high-shelf EQ, the honest control (adds nothing above the cutoff)
  SBR    — spectral band replication, synthesizes plausible highs above the cutoff

Everything runs offline on the CPU. The A/B player is loudness-matched (BS.1770) so
'brighter' is never mistaken for 'louder'. Metrics are MEASURED on the real output and
badged: the app never claims to RECOVER lost signal, only to CONTINUE the band plausibly.
"""
from __future__ import annotations

import os
import sys
import threading

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtMultimedia import QAudioFormat, QAudioSink, QMediaDevices

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dfa import dsp, io_audio

ACCENT = "#e0a44a"   # warm amber — the "analog" register (distinct from Detail Forge teal)


QSS = """
* { color: #d7dbe2; font-family: -apple-system, 'SF Pro Text', sans-serif; font-size: 13px; }
QWidget#root { background: #0c0d10; }
QLabel#h1 { font-size: 22px; font-weight: 800; color: %(accent)s; }
QLabel#sub { color: #79808c; font-size: 12px; }
QFrame.card { background: #15171b; border: 1px solid #23262d; border-radius: 12px; }
QLabel.section { color: #79808c; font-size: 11px; font-weight: 800; letter-spacing: 1px; }
QLabel.ulabel { color: #79808c; font-size: 10px; font-weight: 700; letter-spacing: .5px; }
QLabel.val { color: #d7dbe2; font-family: 'SF Mono', monospace; font-weight: 600; }
QPushButton { background: #1b1e24; border: 1px solid #2b2f37; border-radius: 8px; padding: 7px 12px; }
QPushButton:hover { border-color: %(accent)s; }
QPushButton#run { background: %(accent)s; color: #201603; font-weight: 800; font-size: 14px; padding: 11px; border: 0; }
QPushButton#run:disabled { background: #47391f; color: #8a7d6a; }
QPushButton#stop { background: transparent; border: 1px solid #7a4340; color: #ffb0ad; }
QPushButton.seg { background: #101216; border: 1px solid #23262d; padding: 9px; }
QPushButton.seg:checked { background: %(accent)s; color: #0c0d10; font-weight: 700; }
QPushButton#ab { background: #101216; border: 1px solid #2b2f37; font-weight: 800; font-size: 15px; padding: 12px; }
QPushButton#ab[side="B"] { background: %(accent)s; color: #0c0d10; }
QSlider::groove:horizontal { height: 5px; background: #23262d; border-radius: 3px; }
QSlider::sub-page:horizontal { height: 5px; background: %(accent)s; border-radius: 3px; }
QSlider::handle:horizontal { width: 15px; height: 15px; margin: -6px 0; border-radius: 8px;
    background: %(accent)s; border: 2px solid #1a1206; }
QProgressBar { background: #23262d; border: 0; border-radius: 5px; height: 9px; text-align: center; }
QProgressBar::chunk { background: %(accent)s; border-radius: 5px; }
QLabel#banner { color: #e8cfa0; background: rgba(224,164,74,25); border: 1px solid rgba(224,164,74,80);
    border-radius: 10px; padding: 10px 13px; font-size: 12px; }
QLabel#drop { border: 1.5px dashed #2b2f37; border-radius: 10px; color: #79808c; padding: 22px; }
"""  % {"accent": ACCENT}


# ============================================================= level-matched A/B player
class ABDevice(QtCore.QIODevice):
    """Pull-mode source for QAudioSink. Holds original(A) + processed(B) PCM at equal
    length; flip() swaps which one feeds at the SAME sample position — instant, gapless,
    position-matched. B is pre-scaled to match A's loudness so the flip is a fair test."""

    def __init__(self, a_bytes: bytes, b_bytes: bytes):
        super().__init__()
        n = min(len(a_bytes), len(b_bytes))
        n -= n % 4  # whole stereo int16 frames
        self.buffers = [a_bytes[:n], b_bytes[:n]]
        self.active = 0
        self.pos = 0

    def isSequential(self):
        return True

    def flip(self):
        self.active ^= 1

    def set_side(self, side: int):
        self.active = 1 if side else 0

    def readData(self, maxlen):
        buf = self.buffers[self.active]
        if not buf:
            return b"\x00" * maxlen
        out = bytearray()
        need = maxlen
        while need > 0:
            if self.pos >= len(buf):
                self.pos = 0  # loop
            take = min(need, len(buf) - self.pos)
            out += buf[self.pos:self.pos + take]
            self.pos += take
            need -= take
        return bytes(out)

    def writeData(self, data):
        return 0

    def bytesAvailable(self):
        return len(self.buffers[self.active]) + super().bytesAvailable()


class ABPlayer(QtCore.QObject):
    def __init__(self, sr: int):
        super().__init__()
        fmt = QAudioFormat()
        fmt.setSampleRate(sr)
        fmt.setChannelCount(2)
        fmt.setSampleFormat(QAudioFormat.SampleFormat.Int16)
        self.fmt = fmt
        self.sink = QAudioSink(QMediaDevices.defaultAudioOutput(), fmt)
        self.dev = None

    def load(self, a_bytes, b_bytes):
        self.stop()
        self.dev = ABDevice(a_bytes, b_bytes)
        self.dev.open(QtCore.QIODevice.OpenModeFlag.ReadOnly)

    def play(self):
        if self.dev:
            self.sink.start(self.dev)

    def stop(self):
        self.sink.stop()

    def flip(self):
        if self.dev:
            self.dev.flip()
            return self.dev.active
        return 0


# ================================================================== spectrogram widget
class SpectroPair(QtWidgets.QWidget):
    """Before/after log-spectrograms with the measured cutoff line and the synthesized
    band tinted, so the added content is visible, not just audible."""

    on_select = QtCore.Signal(float, float)   # (t0, t1) seconds

    def __init__(self):
        super().__init__()
        self.setMinimumHeight(260)
        self.before = None
        self.after = None
        self.sr = 44100
        self.fc = None
        self.duration = 0.0
        self._selx = None
        self.setCursor(QtCore.Qt.CursorShape.IBeamCursor)

    def mousePressEvent(self, e):
        if self.duration > 0:
            self._selx = [e.position().x(), e.position().x()]
            self.update()

    def mouseMoveEvent(self, e):
        if self._selx is not None:
            self._selx[1] = e.position().x()
            self.update()

    def mouseReleaseEvent(self, e):
        if self._selx is None or self.duration <= 0:
            return
        x0, x1 = sorted(self._selx)
        if x1 - x0 < 6:            # click = clear selection
            self._selx = None
            self.on_select.emit(0.0, self.duration)
        else:
            w = max(1, self.width())
            self.on_select.emit(self.duration * x0 / w, self.duration * x1 / w)
        self.update()

    def set_data(self, before, after, sr, fc, duration=None):
        self.before, self.after, self.sr, self.fc = before, after, sr, fc
        if duration is not None:
            self.duration = duration
        self.update()

    @staticmethod
    def _to_image(S):
        # magma-ish ramp: dark -> amber -> white
        v = np.clip(S, 0, 1)
        r = np.clip(1.6 * v, 0, 1)
        g = np.clip(1.5 * v - 0.4, 0, 1)
        b = np.clip(2.2 * v - 1.2, 0, 1)
        rgb = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
        rgb = np.flipud(rgb)  # low freq at bottom
        h, w, _ = rgb.shape
        rgb = np.ascontiguousarray(rgb)
        return QtGui.QImage(rgb.data, w, h, 3 * w, QtGui.QImage.Format.Format_RGB888).copy()

    def paintEvent(self, ev):
        p = QtGui.QPainter(self)
        p.fillRect(self.rect(), QtGui.QColor("#0a0b0e"))
        if self.before is None:
            p.setPen(QtGui.QColor("#525863"))
            p.drawText(self.rect(), QtCore.Qt.AlignmentFlag.AlignCenter,
                       "spectrogram — load a file and process")
            return
        w = self.width()
        gap = 10
        pane_h = (self.height() - gap) // 2
        for i, (S, label) in enumerate([(self.before, "BEFORE — source"),
                                        (self.after, "AFTER — enhanced")]):
            y0 = i * (pane_h + gap)
            img = self._to_image(S).scaled(w, pane_h,
                    QtCore.Qt.AspectRatioMode.IgnoreAspectRatio,
                    QtCore.Qt.TransformationMode.SmoothTransformation)
            p.drawImage(0, y0, img)
            # measured cutoff line
            if self.fc:
                fr = self.fc / (self.sr / 2.0)
                ly = y0 + pane_h - int(fr * pane_h)
                p.setPen(QtGui.QPen(QtGui.QColor(224, 164, 74, 200), 1,
                                    QtCore.Qt.PenStyle.DashLine))
                p.drawLine(0, ly, w, ly)
                if i == 1:
                    p.fillRect(0, y0, w, ly - y0, QtGui.QColor(224, 164, 74, 26))
            p.setPen(QtGui.QColor("#cfd6df"))
            p.drawText(8, y0 + 16, label)
            if self.fc:
                p.setPen(QtGui.QColor(224, 164, 74))
                p.drawText(w - 118, y0 + 16, f"cutoff {self.fc:.0f} Hz")
        if self._selx is not None:
            x0, x1 = sorted(self._selx)
            p.fillRect(QtCore.QRectF(x0, 0, x1 - x0, self.height()),
                       QtGui.QColor(224, 164, 74, 40))
            p.setPen(QtGui.QPen(QtGui.QColor(224, 164, 74, 200), 1))
            p.drawLine(int(x0), 0, int(x0), self.height())
            p.drawLine(int(x1), 0, int(x1), self.height())


# ============================================================================= worker
class Worker(QtCore.QObject):
    progress = QtCore.Signal(float, str)
    finished = QtCore.Signal(dict)
    failed = QtCore.Signal(str)

    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self.cancel = threading.Event()

    @QtCore.Slot()
    def run(self):
        try:
            c = self.cfg
            x, sr = c["x"], c["sr"]
            full_x = x
            t0, t1 = c.get("sel", (0.0, 0.0))
            n0, n1 = int(t0 * sr), int(t1 * sr)
            selective = 0 <= n0 < n1 <= len(x) and (n1 - n0) < len(x) - int(0.05 * sr)
            if selective:
                x = np.ascontiguousarray(x[n0:n1])
            self.progress.emit(10.0, "measuring source cutoff…")
            fc = dsp.estimate_cutoff(x, sr)
            if self.cancel.is_set():
                return
            if c["arm"] == "floor":
                self.progress.emit(45.0, "high-shelf (honest control)…")
                out = dsp.floor_highshelf(x, sr, gain_db=c["gain_db"], fc=0.5 * fc)
                info = {"fc": fc}
            elif c["arm"] == "exciter":
                self.progress.emit(40.0, "harmonic exciter (4× oversampled)…")
                out = dsp.exciter(x, sr, fc=fc, drive=c.get("drive", 4.0),
                                  mix=c.get("emix", 0.35))
                info = {"fc": fc}
            elif c["arm"] == "transient":
                self.progress.emit(40.0, "transient restore (dynamic gain)…")
                out = dsp.transient_restore(x, sr, amount=c.get("tamt", 0.6))
                info = {"fc": fc}
            else:
                self.progress.emit(35.0, "spectral band replication…")
                out, info = dsp.sbr_enhance(x, sr, fc=fc, target_hz=c["target_hz"],
                                            wet=c["wet"], tilt_db_oct=c["tilt"])
            if self.cancel.is_set():
                return
            if selective:
                spliced = np.array(full_x, copy=True)
                seg = out[:n1 - n0]
                xf = min(int(0.05 * sr), len(seg) // 4)
                if xf > 0:
                    t = (0.5 - 0.5 * np.cos(np.pi * np.arange(xf) / xf)).astype(np.float32)
                    tt = t[:, None] if seg.ndim == 2 else t
                    seg[:xf] = seg[:xf] * tt + spliced[n0:n0 + xf] * (1 - tt)
                    seg[-xf:] = seg[-xf:] * tt[::-1] + spliced[n1 - xf:n1] * (1 - tt[::-1])
                spliced[n0:n1] = seg
                out = spliced
                x = full_x
            self.progress.emit(80.0, "measuring result…")
            res = {
                "out": out, "sr": sr, "arm": c["arm"], "fc": fc,
                "bw_before": dsp.bandwidth_hz(x, sr),
                "bw_after": dsp.bandwidth_hz(out, sr),
                "hb_before": dsp.high_band_level_db(x, fc, sr),
                "hb_after": dsp.high_band_level_db(out, fc, sr),
                "lsd": dsp.lsd_shared_band(out, x, fc, sr),
                "nr": dsp.nr_quality(out, fc, sr),
                "gain": dsp.loudness_gain(out, x, sr),
                "info": info,
            }
            self.progress.emit(100.0, "done")
            self.finished.emit(res)
        except Exception as e:
            import traceback
            self.failed.emit(f"{e}\n{traceback.format_exc()[-400:]}")


# ============================================================================ main win
class MainWindow(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.setObjectName("root")
        self.setWindowTitle("Detail Forge Analog")
        self.resize(1180, 820)
        self.setAcceptDrops(True)
        self.x = None
        self.sr = None
        self.path = None
        self.out = None
        self.player = None
        self.arm = "sbr"
        self._build()

    def _build(self):
        root = QtWidgets.QVBoxLayout(self)
        root.setContentsMargins(18, 16, 18, 16)
        root.setSpacing(12)

        h1 = QtWidgets.QLabel("Detail Forge Analog"); h1.setObjectName("h1")
        sub = QtWidgets.QLabel("local audio detail synthesis · offline · honest by construction")
        sub.setObjectName("sub")
        root.addWidget(h1); root.addWidget(sub)

        banner = QtWidgets.QLabel(
            "This does not recover lost audio — a band-limited source cannot be restored, "
            "only continued. FLOOR is EQ (invents nothing). SBR synthesizes plausible highs "
            "above the measured cutoff. Every number below is measured on the real output.")
        banner.setObjectName("banner"); banner.setWordWrap(True)
        root.addWidget(banner)

        body = QtWidgets.QHBoxLayout(); body.setSpacing(12); root.addLayout(body, 1)

        # ---- left column: controls (fixed width)
        left_w = QtWidgets.QWidget(); left_w.setFixedWidth(346)
        left = QtWidgets.QVBoxLayout(left_w); left.setContentsMargins(0, 0, 0, 0); left.setSpacing(12)
        body.addWidget(left_w, 0)

        src = self._card("SOURCE")
        self.drop = QtWidgets.QLabel("drop an audio file\nor click to open"); self.drop.setObjectName("drop")
        self.drop.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.drop.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
        self.drop.mousePressEvent = lambda e: self._open()
        src.addWidget(self.drop)
        self.src_info = QtWidgets.QLabel("no file loaded"); self.src_info.setProperty("class", "val")
        self.src_info.setStyleSheet("color:#a7adb8;font-family:'SF Mono';font-size:11px;")
        self.src_info.setWordWrap(True)
        src.addWidget(self.src_info)
        selrow = QtWidgets.QHBoxLayout()
        sel_lbl = QtWidgets.QLabel("enhance on"); sel_lbl.setProperty("class", "ulabel")
        self.sel_t0 = QtWidgets.QDoubleSpinBox(); self.sel_t0.setDecimals(2)
        self.sel_t0.setSuffix(" s"); self.sel_t0.setEnabled(False)
        self.sel_t1 = QtWidgets.QDoubleSpinBox(); self.sel_t1.setDecimals(2)
        self.sel_t1.setSuffix(" s"); self.sel_t1.setEnabled(False)
        arrow = QtWidgets.QLabel("→"); arrow.setStyleSheet("color:#79808c;")
        self.sel_full = QtWidgets.QPushButton("full"); self.sel_full.setFixedWidth(44)
        self.sel_full.clicked.connect(self._sel_reset); self.sel_full.setEnabled(False)
        selrow.addWidget(sel_lbl); selrow.addWidget(self.sel_t0); selrow.addWidget(arrow)
        selrow.addWidget(self.sel_t1); selrow.addWidget(self.sel_full)
        src.addLayout(selrow)
        sel_hint = QtWidgets.QLabel("narrow the range to enhance just that stretch — "
                                    "50 ms crossfades at the seams, rest untouched")
        sel_hint.setStyleSheet("color:#525863;font-size:11px;"); sel_hint.setWordWrap(True)
        src.addWidget(sel_hint)
        left.addWidget(self._cardframe(src))

        eng = self._card("ENGINE")
        seg = QtWidgets.QGridLayout(); seg.setSpacing(8)
        self.seg_floor = QtWidgets.QPushButton("FLOOR\nhigh-shelf")
        self.seg_sbr = QtWidgets.QPushButton("SBR\nband replication")
        self.seg_exc = QtWidgets.QPushButton("EXCITER\nharmonics")
        self.seg_trn = QtWidgets.QPushButton("TRANSIENT\nattack restore")
        self._seg_map = {"floor": self.seg_floor, "sbr": self.seg_sbr,
                         "exciter": self.seg_exc, "transient": self.seg_trn}
        for i, (name, b) in enumerate(self._seg_map.items()):
            b.setProperty("class", "seg"); b.setCheckable(True)
            b.setMinimumHeight(46)
            b.clicked.connect(lambda _c, n=name: self._set_arm(n))
            seg.addWidget(b, i // 2, i % 2)
        self.seg_sbr.setChecked(True)
        eng.addLayout(seg)
        arm_hint = QtWidgets.QLabel("FLOOR = honest control (adds nothing above cutoff).  "
                                    "SBR = folds the top octave upward, tilted + decorrelated.")
        arm_hint.setStyleSheet("color:#525863;font-size:11px;"); arm_hint.setWordWrap(True)
        eng.addWidget(arm_hint)

        # SBR params
        self.sbr_box = QtWidgets.QWidget(); sb = QtWidgets.QVBoxLayout(self.sbr_box)
        sb.setContentsMargins(0, 4, 0, 0)
        self.s_wet, wetrow = self._slider("wet (synthesized amount)", 0, 100, 65, "%")
        self.s_tilt, tiltrow = self._slider("HF tilt (dB/oct)", -14, -2, -6, "")
        self.s_target, tgtrow = self._slider("target ceiling (kHz)", 10, 22, 20, "k")
        for r in (wetrow, tiltrow, tgtrow):
            sb.addLayout(r)
        eng.addWidget(self.sbr_box)

        # FLOOR params
        self.floor_box = QtWidgets.QWidget(); fb = QtWidgets.QVBoxLayout(self.floor_box)
        fb.setContentsMargins(0, 4, 0, 0)
        self.s_gain, grow = self._slider("shelf gain (dB)", 0, 18, 9, "dB")
        fb.addLayout(grow)
        eng.addWidget(self.floor_box)
        self.floor_box.hide()

        self.exc_box = QtWidgets.QWidget(); eb = QtWidgets.QVBoxLayout(self.exc_box)
        eb.setContentsMargins(0, 4, 0, 0)
        self.s_drive, drow = self._slider("drive", 10, 90, 40, "")
        self.s_emix, erow = self._slider("mix (%)", 5, 80, 35, "%")
        eb.addLayout(drow); eb.addLayout(erow)
        eng.addWidget(self.exc_box)
        self.exc_box.hide()

        self.trn_box = QtWidgets.QWidget(); tb = QtWidgets.QVBoxLayout(self.trn_box)
        tb.setContentsMargins(0, 4, 0, 0)
        self.s_tamt, trow = self._slider("attack amount (%)", 10, 100, 60, "%")
        tb.addLayout(trow)
        eng.addWidget(self.trn_box)
        self.trn_box.hide()

        runrow = QtWidgets.QHBoxLayout()
        self.run_btn = QtWidgets.QPushButton("Enhance"); self.run_btn.setObjectName("run")
        self.run_btn.clicked.connect(self._run)
        self.stop_btn = QtWidgets.QPushButton("Stop"); self.stop_btn.setObjectName("stop")
        self.stop_btn.clicked.connect(self._stop); self.stop_btn.hide()
        runrow.addWidget(self.run_btn, 1); runrow.addWidget(self.stop_btn)
        eng.addLayout(runrow)
        self.prog = QtWidgets.QProgressBar(); self.prog.setTextVisible(False); self.prog.hide()
        eng.addWidget(self.prog)
        self.pstat = QtWidgets.QLabel(""); self.pstat.setStyleSheet("color:#a7adb8;font-size:12px;")
        eng.addWidget(self.pstat)
        left.addWidget(self._cardframe(eng))
        left.addStretch(1)

        # ---- right column: spectrogram + A/B + metrics
        right = QtWidgets.QVBoxLayout(); right.setSpacing(12); body.addLayout(right, 1)
        self.spectro = SpectroPair()
        self.spectro.on_select.connect(self._on_spectro_select)
        scard = self._card("SPECTRUM", self.spectro)
        right.addWidget(self._cardframe(scard), 1)

        abcard = self._card("LISTEN — level-matched A/B")
        abrow = QtWidgets.QHBoxLayout()
        self.ab_btn = QtWidgets.QPushButton("A · source"); self.ab_btn.setObjectName("ab")
        self.ab_btn.clicked.connect(self._flip); self.ab_btn.setEnabled(False)
        self.play_btn = QtWidgets.QPushButton("▶ play"); self.play_btn.clicked.connect(self._toggle_play)
        self.play_btn.setEnabled(False)
        abrow.addWidget(self.play_btn); abrow.addWidget(self.ab_btn, 1)
        abcard.addLayout(abrow)
        abhint = QtWidgets.QLabel("Spacebar or click to flip A↔B at the same instant. B is "
                                  "loudness-matched (BS.1770) — brighter, never just louder.")
        abhint.setStyleSheet("color:#525863;font-size:11px;"); abhint.setWordWrap(True)
        abcard.addWidget(abhint)
        right.addWidget(self._cardframe(abcard))

        mcard = self._card("MEASURED")
        self.metrics = QtWidgets.QLabel("—")
        self.metrics.setStyleSheet("color:#c7cdd8;font-family:'SF Mono';font-size:12px;")
        self.metrics.setTextFormat(QtCore.Qt.TextFormat.RichText)
        self.metrics.setWordWrap(True)
        mcard.addWidget(self.metrics)
        saverow = QtWidgets.QHBoxLayout()
        self.save_btn = QtWidgets.QPushButton("Save WAV…"); self.save_btn.clicked.connect(self._save)
        self.save_btn.setEnabled(False)
        self.reveal_btn = QtWidgets.QPushButton("Reveal"); self.reveal_btn.clicked.connect(self._reveal)
        self.reveal_btn.setEnabled(False)
        saverow.addWidget(self.save_btn); saverow.addWidget(self.reveal_btn)
        self.send_neb = QtWidgets.QPushButton("→ Nebula"); self.send_neb.setEnabled(False)
        self.send_neb.clicked.connect(lambda: self._send_to("/Applications/Nebula.app"))
        self.send_chi = QtWidgets.QPushButton("→ Chimera"); self.send_chi.setEnabled(False)
        self.send_chi.clicked.connect(lambda: self._send_to("/Applications/Chimera Synth.app"))
        saverow.addWidget(self.send_neb); saverow.addWidget(self.send_chi); saverow.addStretch(1)
        mcard.addLayout(saverow)
        right.addWidget(self._cardframe(mcard))

        self._saved_path = None

    # ---------- small builders
    def _card(self, title, widget=None):
        v = QtWidgets.QVBoxLayout(); v.setSpacing(9)
        lbl = QtWidgets.QLabel(title); lbl.setProperty("class", "section")
        v.addWidget(lbl)
        if widget is not None:
            v.addWidget(widget, 1)
        return v

    def _cardframe(self, layout):
        f = QtWidgets.QFrame(); f.setProperty("class", "card")
        f.setStyleSheet("QFrame{background:#15171b;border:1px solid #23262d;border-radius:12px;}")
        inner = QtWidgets.QVBoxLayout(f); inner.setContentsMargins(14, 12, 14, 14)
        inner.addLayout(layout)
        return f

    def _slider(self, label, mn, mx, val, unit):
        row = QtWidgets.QVBoxLayout(); row.setSpacing(2)
        top = QtWidgets.QHBoxLayout()
        l = QtWidgets.QLabel(label); l.setProperty("class", "ulabel")
        v = QtWidgets.QLabel(f"{val}{unit}"); v.setProperty("class", "val")
        v.setStyleSheet("color:#e0a44a;font-family:'SF Mono';font-weight:700;")
        top.addWidget(l); top.addStretch(1); top.addWidget(v)
        s = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        s.setRange(mn, mx); s.setValue(val)
        s.valueChanged.connect(lambda x: v.setText(f"{x}{unit}"))
        row.addLayout(top); row.addWidget(s)
        return s, row

    def _left_card(self, layout, left):
        left.addWidget(self._cardframe(layout))

    # override _card usage for left column cards (need frames)
    def _add_left_cards(self):
        pass

    # ---------- state
    def _set_arm(self, name):
        self.arm = name
        for n, b in self._seg_map.items():
            b.setChecked(n == name)
        self.sbr_box.setVisible(name == "sbr")
        self.floor_box.setVisible(name == "floor")
        self.exc_box.setVisible(name == "exciter")
        self.trn_box.setVisible(name == "transient")

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        urls = e.mimeData().urls()
        if urls:
            self._load(urls[0].toLocalFile())

    def _open(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Open audio", "", "Audio (*.wav *.flac *.aiff *.aif *.ogg *.mp3 *.m4a *.aac)")
        if path:
            self._load(path)

    def _load(self, path):
        try:
            x, sr = io_audio.load_audio(path)
        except Exception as e:
            self.src_info.setText(f"could not load: {e}")
            return
        self.x, self.sr, self.path = x, sr, path
        dur = len(x) / sr
        for sb in (self.sel_t0, self.sel_t1):
            sb.setRange(0.0, round(dur, 2)); sb.setEnabled(True)
        self.sel_t0.setValue(0.0); self.sel_t1.setValue(round(dur, 2))
        self.sel_full.setEnabled(True)
        ch = 1 if x.ndim == 1 else x.shape[1]
        fc = dsp.estimate_cutoff(x, sr)
        self.src_info.setText(
            f"{os.path.basename(path)}\n{dur:.1f}s · {sr} Hz · {ch}ch\n"
            f"measured cutoff ≈ {fc:.0f} Hz")
        f, t, S = dsp.spectrogram(x, sr)
        self.spectro.set_data(S, S, sr, fc, duration=dur)
        self.run_btn.setEnabled(True)
        self.pstat.setText("ready")

    def _on_spectro_select(self, t0, t1):
        self.sel_t0.setValue(round(t0, 2))
        self.sel_t1.setValue(round(t1, 2))

    def _sel_reset(self):
        if self.x is not None:
            self.sel_t0.setValue(0.0)
            self.sel_t1.setValue(round(len(self.x) / self.sr, 2))

    def _run(self):
        if self.x is None:
            return
        cfg = {
            "x": self.x, "sr": self.sr, "arm": self.arm,
            "wet": self.s_wet.value() / 100.0,
            "tilt": float(self.s_tilt.value()),
            "target_hz": self.s_target.value() * 1000.0,
            "gain_db": float(self.s_gain.value()),
            "drive": self.s_drive.value() / 10.0,
            "emix": self.s_emix.value() / 100.0,
            "tamt": self.s_tamt.value() / 100.0,
            "sel": (self.sel_t0.value(), self.sel_t1.value()),
        }
        self.worker = Worker(cfg)
        self.thread = QtCore.QThread()
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self._on_progress)
        self.worker.finished.connect(self._on_finished)
        self.worker.failed.connect(self._on_failed)
        self.run_btn.hide(); self.stop_btn.show(); self.prog.show(); self.prog.setValue(0)
        self.thread.start()

    def _stop(self):
        if hasattr(self, "worker"):
            self.worker.cancel.set()
        self._teardown()
        self.pstat.setText("stopped")

    def _on_progress(self, pct, line):
        self.prog.setValue(int(pct)); self.pstat.setText(line)

    def _on_finished(self, res):
        self.out = res["out"]; self._res = res
        self._teardown()
        # spectrograms
        _, _, Sb = dsp.spectrogram(self.x, self.sr)
        _, _, Sa = dsp.spectrogram(self.out, self.sr)
        self.spectro.set_data(Sb, Sa, self.sr, res["fc"], duration=len(self.x)/self.sr)
        # A/B player, loudness-matched
        a = io_audio.to_int16_stereo_bytes(self.x, 1.0)
        b = io_audio.to_int16_stereo_bytes(self.out, res["gain"])
        if self.player is None or self.player.fmt.sampleRate() != self.sr:
            self.player = ABPlayer(self.sr)
        self.player.load(a, b)
        self.play_btn.setEnabled(True); self.ab_btn.setEnabled(True)
        self.save_btn.setEnabled(True)
        self.send_neb.setEnabled(True); self.send_chi.setEnabled(True)
        self._render_metrics(res)

    def _render_metrics(self, r):
        nr = r["nr"]
        arm = {"sbr": "SBR (synthesized)", "floor": "FLOOR (EQ — measured)",
               "exciter": "EXCITER (harmonics of existing — synthesized)",
               "transient": "TRANSIENT (dynamic gain — measured)"}[r["arm"]]
        gained = r["bw_after"] - r["bw_before"]
        hb_rise = r["hb_after"] - r["hb_before"]
        # FLOOR amplifies existing energy; only SBR synthesizes new content
        rise_word = ("synthesized" if r["arm"] in ("sbr", "exciter") else "amplified")
        nr_col = "#8fd68f" if nr.get("ok") else "#ffb0ad"
        lsd_col = "#8fd68f" if r["lsd"] < 3.0 else "#e8cfa0"
        html = (
            f"<b style='color:{ACCENT}'>{arm}</b><br><br>"
            f"bandwidth&nbsp; <b>{r['bw_before']:.0f}</b> → <b>{r['bw_after']:.0f} Hz</b>"
            f"&nbsp;<span style='color:{ACCENT}'>(+{gained:.0f})</span> "
            f"<span style='color:#6a7078'>· MEASURED</span><br>"
            f"high band above cutoff:&nbsp; <b>{r['hb_before']:.0f}</b> → <b>{r['hb_after']:.0f} dB</b>"
            f"&nbsp;<span style='color:{ACCENT}'>(+{hb_rise:.0f} {rise_word})</span> "
            f"<span style='color:#6a7078'>· MEASURED</span><br>"
            f"original band preserved (LSD):&nbsp; <b style='color:{lsd_col}'>{r['lsd']:.2f} dB</b> "
            f"<span style='color:#6a7078'>· lower = truer</span><br>"
            f"synthesized-band character:&nbsp; <b style='color:{nr_col}'>{nr['verdict']}</b> "
            f"<span style='color:#6a7078'>· flatness {nr['flatness']:.3f}</span><br>"
            f"A/B loudness match:&nbsp; <b>{r['gain']:.2f}×</b> "
            f"<span style='color:#6a7078'>· BS.1770</span>"
        )
        if r["arm"] == "sbr" and not nr.get("ok"):
            html += ("<br><br><span style='color:#ffb0ad'>⚠ synthesized band reads as "
                     "hiss — lower wet or tilt, or the source may be too narrow.</span>")
        self.metrics.setText(html)

    def _on_failed(self, msg):
        self._teardown()
        self.pstat.setText("failed")
        self.metrics.setText(f"<span style='color:#ffb0ad'>{msg}</span>")

    def _teardown(self):
        if hasattr(self, "thread") and self.thread is not None:
            self.thread.quit(); self.thread.wait(2000)
            self.thread = None
        self.run_btn.show(); self.stop_btn.hide(); self.prog.hide()

    # ---------- playback
    def _toggle_play(self):
        if self.player is None:
            return
        if self.play_btn.text().startswith("▶"):
            self.player.play(); self.play_btn.setText("⏸ stop")
        else:
            self.player.stop(); self.play_btn.setText("▶ play")

    def _flip(self):
        if self.player is None:
            return
        side = self.player.flip()
        self.ab_btn.setText("B · enhanced" if side else "A · source")
        self.ab_btn.setProperty("side", "B" if side else "A")
        self.ab_btn.style().unpolish(self.ab_btn); self.ab_btn.style().polish(self.ab_btn)

    def keyPressEvent(self, e):
        if e.key() == QtCore.Qt.Key.Key_Space and self.ab_btn.isEnabled():
            self._flip()
        else:
            super().keyPressEvent(e)

    # ---------- save
    def _save(self):
        if self.out is None:
            return
        base = os.path.splitext(os.path.basename(self.path))[0]
        default = os.path.join(os.path.expanduser("~/Downloads"), f"{base}_analog.wav")
        dest, _ = QtWidgets.QFileDialog.getSaveFileName(self, "Save enhanced WAV", default,
                                                        "WAV (*.wav)")
        if dest:
            io_audio.save_wav(dest, self.out, self.sr)
            self._saved_path = dest
            self.pstat.setText(f"saved · {dest}")
            self.reveal_btn.setEnabled(True)

    def _send_to(self, app_path):
        if self.out is None:
            return
        import subprocess, tempfile
        base = os.path.splitext(os.path.basename(self.path or "enhanced"))[0]
        dest = os.path.join(tempfile.gettempdir(), f"{base}_analog.wav")
        io_audio.save_wav(dest, self.out, self.sr)
        subprocess.Popen(["open", "-n", "-a", app_path, "--args", dest])

    def _reveal(self):
        if self._saved_path:
            import subprocess
            subprocess.run(["open", "-R", self._saved_path])


def main():
    app = QtWidgets.QApplication(sys.argv)
    app.setStyleSheet(QSS)
    _argv_file = next((a for a in sys.argv[1:] if os.path.exists(a)), None)
    # frame the left-column cards
    w = MainWindow()
    w.show()
    if _argv_file:
        QtCore.QTimer.singleShot(400, lambda: w._load(_argv_file))
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
