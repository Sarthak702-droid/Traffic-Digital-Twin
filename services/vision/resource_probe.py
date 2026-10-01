"""Measured process resources for one fresh inference job (Linux prototype)."""
import resource
import sys
import threading
import time


class ProcessResourceProbe:
    def __init__(self):
        self.started = time.monotonic()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        self.cpu_started = self.last_cpu = usage.ru_utime + usage.ru_stime
        self.last_wall = self.started
        self.peak_cpu_percent = 0.0
        self.finished = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)
        self.thread.start()

    def _sample_once(self):
        now = time.monotonic()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        cpu = usage.ru_utime + usage.ru_stime
        elapsed = now - self.last_wall
        if elapsed >= 0.05:
            self.peak_cpu_percent = max(self.peak_cpu_percent, 100 * (cpu - self.last_cpu) / elapsed)
            self.last_cpu, self.last_wall = cpu, now

    def _sample(self):
        while not self.finished.wait(0.1):
            self._sample_once()

    def result(self, frames):
        self.close()
        self._sample_once()
        wall = time.monotonic() - self.started
        usage = resource.getrusage(resource.RUSAGE_SELF)
        return {"wall_s": wall, "inference_frames": frames,
                "fresh_inference_fps": frames / wall if frames is not None else None,
                "peak_cpu_percent": self.peak_cpu_percent,
                "cpu_s": usage.ru_utime + usage.ru_stime - self.cpu_started,
                "peak_ram_bytes": int(usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024)),
                "measurement_scope": "fresh_job_process; cpu sampled at 100ms; RSS process lifetime peak"}

    def close(self):
        self.finished.set()
        self.thread.join(timeout=1)
