// #engine v8
// AlignRGB Preview v0.3
// Morten Lerager 12-10-26


#feature-id MyScripts > AlignRGBPreview
#feature-info Automatic RGB channel alignment using a Preview ROI.

#include <pjsr/UndoFlag.jsh>

(function () {
   var win = ImageWindow.activeWindow;
   if (win.isNull) throw new Error("Open an RGB image and select a preview first.");
   var pv = win.currentView;
   if (!pv.isPreview) throw new Error("Select a Preview containing the planet before running AlignRGB.");
   var src = win.mainView.image;
   if (!src.isColor || src.numberOfChannels < 3) throw new Error("The source must be an RGB image.");
   var roi = pv.image;
   var w = roi.width, h = roi.height;
   if (w < 20 || h < 20) throw new Error("Preview is too small.");
   var arrays = [[],[],[]];
   for (var c=0;c<3;++c) roi.getSamples(arrays[c], new Rect(0,0,w,h), c);
   var limit = 10;
   function score(channel, dx, dy) {
      var margin = limit + 2;
      var step = Math.max(1, Math.floor(Math.min(w,h)/220));
      var a=arrays[1], b=arrays[channel], n=0;
      var sa=0,sb=0,saa=0,sbb=0,sab=0;
      for(var y=margin;y<h-margin;y+=step) {
         var yy=y+dy, yi=Math.floor(yy), fy=yy-yi;
         for(var x=margin;x<w-margin;x+=step) {
            var xx=x+dx, xi=Math.floor(xx), fx=xx-xi;
            var k=y*w+x, p=yi*w+xi;
            var v=a[k];
            var t=b[p]*(1-fx)*(1-fy)+b[p+1]*fx*(1-fy)+b[p+w]*(1-fx)*fy+b[p+w+1]*fx*fy;
            sa+=v;sb+=t;saa+=v*v;sbb+=t*t;sab+=v*t;++n;
         }
      }
      var va=saa-sa*sa/n, vb=sbb-sb*sb/n;
      return va>0 && vb>0 ? (sab-sa*sb/n)/Math.sqrt(va*vb) : -1;
   }
   function findShift(c) {
      var best={dx:0,dy:0,s:-Infinity};
      for(var dy=-limit;dy<=limit;++dy) for(var dx=-limit;dx<=limit;++dx) {
         var s=score(c,dx,dy); if(s>best.s) best={dx:dx,dy:dy,s:s};
      }
      // Coarse-to-fine fractional pixel search.
      for(var step=0.5;step>=0.125;step/=2) {
         var next=best;
         for(var j=-1;j<=1;++j) for(var i=-1;i<=1;++i) {
            var tx=best.dx+i*step, ty=best.dy+j*step;
            if(Math.abs(tx)>limit || Math.abs(ty)>limit) continue;
            var ss=score(c,tx,ty);
            if(ss>next.s) next={dx:tx,dy:ty,s:ss};
         }
         best=next;
      }
      return best;
   }
   Console.show();
   Console.writeln("AlignRGB Preview v0.3 - measuring shifts...");
   var r=findShift(0), b=findShift(2);
   Console.writeln("R sampling offset: x="+r.dx.toFixed(3)+", y="+r.dy.toFixed(3)+" (NCC "+r.s.toFixed(4)+")");
   Console.writeln("B sampling offset: x="+b.dx.toFixed(3)+", y="+b.dy.toFixed(3)+" (NCC "+b.s.toFixed(4)+")");
   // Find the exact rectangular intersection where both shifted channels
   // have full Lanczos-3 support. The green channel needs no resampling.
   var W=src.width,H=src.height;
   function validX(x,shift) {
      var ix=Math.floor(x+shift.dx);
      return ix-2>=0 && ix+3<W;
   }
   function validY(y,shift) {
      var iy=Math.floor(y+shift.dy);
      return iy-2>=0 && iy+3<H;
   }
   var left=0,right=W-1,top=0,bottom=H-1;
   while(left<W && !(validX(left,r)&&validX(left,b))) ++left;
   while(right>=left && !(validX(right,r)&&validX(right,b))) --right;
   while(top<H && !(validY(top,r)&&validY(top,b))) ++top;
   while(bottom>=top && !(validY(bottom,r)&&validY(bottom,b))) --bottom;
   if(right<left || bottom<top) throw new Error("No valid overlap for Lanczos-3 alignment.");
   var cropW=right-left+1,cropH=bottom-top+1;
   Console.writeln("Valid-data crop: left="+left+", right="+(W-1-right)+
      ", top="+top+", bottom="+(H-1-bottom)+" pixels.");
   var out = new ImageWindow(cropW,cropH,3,32,true,true,"AlignRGB_Result");
   var target=out.mainView;
   // Separable Lanczos-3 resampling, with a 6x6 support window.
   // Integer-coordinate samples are copied exactly, without interpolation.
   function sinc(t) {
      if (Math.abs(t) < 1e-12) return 1;
      var z = Math.PI*t;
      return Math.sin(z)/z;
   }
   function lanczos(t) {
      t=Math.abs(t);
      return t < 3 ? sinc(t)*sinc(t/3) : 0;
   }
   function sampleShift(x,y,c,shift) {
      var xx=x+shift.dx, yy=y+shift.dy;
      var ix=Math.floor(xx), iy=Math.floor(yy);
      // Do not fabricate values when the kernel crosses the image boundary.
      if (ix-2<0 || iy-2<0 || ix+3>=W || iy+3>=H) return 0;
      var fx=xx-ix, fy=yy-iy;
      var wx=[], wy=[], sx=0, sy=0;
      for (var j=0;j<6;++j) {
         wx[j]=lanczos(fx-(j-2)); sx+=wx[j];
         wy[j]=lanczos(fy-(j-2)); sy+=wy[j];
      }
      var sum=0;
      for (var j=0;j<6;++j) {
         var row=0;
         for (var i=0;i<6;++i)
            row+=wx[i]*src.sample(ix+i-2,iy+j-2,c);
         sum+=wy[j]*row;
      }
      // RGB source data are normalized; suppress Lanczos overshoot.
      return Math.max(0,Math.min(1,sum/(sx*sy)));
   }
   Console.writeln("Resampling red and blue with Lanczos-3; cropping invalid edges...");
   target.beginProcess(UndoFlag_NoSwapFile);
   try {
      for(var y=0;y<cropH;++y) {
         var sy=y+top;
         for(var x=0;x<cropW;++x) {
            var sx=x+left;
            target.image.setSample(sampleShift(sx,sy,0,r),x,y,0);
            target.image.setSample(src.sample(sx,sy,1),x,y,1);
            target.image.setSample(sampleShift(sx,sy,2,b),x,y,2);
         }
      }
   } finally { target.endProcess(); }
   out.show();
   Console.writeln("Finished (Lanczos-3). Original unchanged. Only invalid edges cropped.");
})();
