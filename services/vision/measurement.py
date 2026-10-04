"""Geometry-normalized image motion; never a physical speed estimate."""
import math

def normalized_motion(previous,current,width,height,elapsed_source_s):
    if width<=0 or height<=0 or elapsed_source_s<=0:raise ValueError('Positive frame dimensions and elapsed source time required')
    value=math.hypot((current[0]-previous[0])/width,(current[1]-previous[1])/height)/elapsed_source_s
    if not math.isfinite(value):raise ValueError('Finite normalized motion required')
    return value
