
import sys
import os
from PIL import Image
import imagehash

CV2_IMPORT_ERROR = ""
try:
    import cv2
except Exception as e:
    cv2 = None
    CV2_IMPORT_ERROR = str(e)

def calculate_phash(file_path):
    try:
        # Determine if it is a video or an image based on extension
        ext = os.path.splitext(file_path)[1].lower()
        if ext in [".mp4", ".mov", ".avi", ".mkv", ".webm"]:
            if cv2 is None:
                sys.stderr.write(
                    "Error: OpenCV (cv2) not available, cannot process video hash. "
                    f"Import error: {CV2_IMPORT_ERROR}\n"
                )
                return None

            # Process as video
            cap = cv2.VideoCapture(file_path)
            if not cap.isOpened():
                sys.stderr.write(f"Error: Could not open video file {file_path}\n")
                return None
            
            # Set to 500ms (0.5 seconds) as requested
            cap.set(cv2.CAP_PROP_POS_MSEC, 500)
            ret, frame = cap.read()
            
            # Fallback to first frame if 500ms is not available
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
                
            cap.release()
            
            if not ret:
                sys.stderr.write(f"Error: Could not read frame from video {file_path}\n")
                return None
                
            # Convert BGR (OpenCV) to RGB (PIL)
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(frame_rgb)
            
        else:
            # Process as standard image
            pil_image = Image.open(file_path)

        # Calculate pHash with hash_size=8 (default is 8, leading to 64 bit / 16 hex chars)
        phash_val = imagehash.phash(pil_image)
        return str(phash_val)
        
    except Exception as e:
        sys.stderr.write(f"Error computing hash for {file_path}: {str(e)}\n")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python calculate_hash.py <file_path>\n")
        sys.exit(1)
        
    file_path = sys.argv[1]
    result = calculate_phash(file_path)
    
    if result:
        # Print only the hash value to standard output so Node.js can read it cleanly
        print(result)
    else:
        sys.exit(1)

