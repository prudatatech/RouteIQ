import subprocess
import sys

def run():
    try:
        out = subprocess.check_output(["git", "log", "-n", "3", "--name-status"], cwd="d:/margixindia-main")
        print("GIT LOG:")
        print(out.decode())
        out = subprocess.check_output(["git", "status"], cwd="d:/margixindia-main")
        print("GIT STATUS:")
        print(out.decode())
    except Exception as e:
        print(e)

if __name__ == "__main__":
    run()
