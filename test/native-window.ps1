# Operate on exactly the owned process AND the title read from its verified page.
param([int]$ProcessId,[string]$WindowTitle)
Add-Type @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class LubiNativeWindow{
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool EnumWindows(Callback cb,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder b,int count);
 [DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int width,int height,bool repaint);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 public static IntPtr Find(uint pid,string title){
  var found=new List<IntPtr>();var titles=new List<string>();
  EnumWindows((h,l)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==pid&&IsWindowVisible(h)){var b=new StringBuilder(1024);GetWindowText(h,b,1024);titles.Add(b.ToString());if(b.ToString()==title)found.Add(h);}return true;},IntPtr.Zero);
  if(found.Count!=1)throw new Exception("Expected one owned window with the exact page title; owned titles: "+String.Join(" | ",titles));return found[0];
 }
}
'@
$h=[LubiNativeWindow]::Find($ProcessId,$WindowTitle)
[uint32]$owner=0
[void][LubiNativeWindow]::GetWindowThreadProcessId($h,[ref]$owner)
if($owner -ne $ProcessId){throw 'Native window ownership mismatch'}
if(-not [LubiNativeWindow]::MoveWindow($h,20,20,1440,1000,$true)){throw 'Could not resize owned native main window'}
