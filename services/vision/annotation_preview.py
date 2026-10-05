"""Private sampled raster preview: boxes/class confidence, no identity history."""
import subprocess
from pathlib import Path

import cv2
import imageio_ffmpeg


class AnnotationEncoder:
    def __init__(self, path, frame, sample_fps, duration_s):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.temporary = self.path.with_suffix('.tmp.mp4')
        height, width = frame.shape[:2]
        self.process = subprocess.Popen([
            imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-hide_banner',
            '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
            '-s', f'{width}x{height}', '-r', str(sample_fps), '-i', 'pipe:0',
            '-an', '-t', str(duration_s), '-c:v', 'libx264', '-threads', '1',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(self.temporary),
        ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def write(self, frame):
        self.process.stdin.write(frame.tobytes())

    def finish(self):
        try:
            self.process.stdin.close()
            if (self.process.wait(timeout=60) != 0 or not self.temporary.is_file()
                    or self.temporary.stat().st_size == 0):
                raise ValueError('Annotation encoder failed; preview not published')
            self.temporary.replace(self.path)
        except BaseException:
            self.abort()
            raise

    def abort(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        try:
            if self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()
        except BrokenPipeError:
            pass
        self.temporary.unlink(missing_ok=True)


def raster_annotations(frame, detections):
    # Association IDs and trails never enter rendered pixels or exported data.
    result = frame.copy()
    height, width = result.shape[:2]
    for detection in detections:
        x1, y1, x2, y2 = [round(v * size) for v, size in
                          zip(detection['bbox'], [width, height, width, height])]
        color = (70, 220, 90)
        cv2.rectangle(result, (x1, y1), (x2, y2), color, 2)
        label = f"{detection['class']} {detection['conf']:.0%}"
        cv2.putText(result, label, (x1, max(12, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, .4, color, 1, cv2.LINE_AA)
    return cv2.copyMakeBorder(result, 0, height % 2, 0, width % 2, cv2.BORDER_CONSTANT)
