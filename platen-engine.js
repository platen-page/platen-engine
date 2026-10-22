/*! Platen engine | MIT licence | https://github.com/platen-page/platen-engine
 *
 * Makes a rendered page (a canvas) look scanned, photocopied, faxed or photographed.
 * Everything runs locally in the browser: no network requests, no uploads.
 * Used by https://platen.page.
 *
 * Load with a <script> tag; it defines globalThis.PlatenEngine:
 *   PlatenEngine.scan(canvas, settings, seed, dpi, side) -> new canvas
 *   PlatenEngine.encodeJPEG(canvas, quality 0..1)        -> Uint8Array (needs jpeg-encoder.js)
 *   PlatenEngine.PRESETS, PAPERS, SURROUND
 */
(function (root) {
"use strict";

/* ---------- presets ---------- */
const PRESETS = {
  office:  {label:"Office scanner", desc:"Clean greyscale, slight skew",
    mode:"gray",dpi:"200",rotation:.7,keystone:0,edge:.25,surround:"lid",contrast:.45,brightness:0,black:.75,bleed:.35,paper:"white",texture:.35,lighting:.4,vignette:.05,noise:.3,streaks:.12,dust:.25,speckle:.1,jpeg:.78},
  flatbed: {label:"Colour flatbed", desc:"Warm paper, soft colour",
    mode:"color",dpi:"200",rotation:.5,keystone:0,edge:.5,surround:"lid",contrast:.3,brightness:.05,black:.7,bleed:.25,paper:"ivory",texture:.5,lighting:.35,vignette:.1,noise:.25,streaks:.05,dust:.2,speckle:.05,jpeg:.82},
  copier:  {label:"Photocopy", desc:"Heavy toner, streaks, grit",
    mode:"gray",dpi:"150",rotation:1.2,keystone:0,edge:.6,surround:"lid",contrast:.8,brightness:.03,black:.92,bleed:.6,paper:"recycled",texture:.6,lighting:.6,vignette:.25,noise:.5,streaks:.6,dust:.6,speckle:.7,jpeg:.7},
  fax:     {label:"Fax", desc:"1-bit, 100 dpi, ragged",
    mode:"bw",dpi:"100",rotation:1,keystone:0,edge:0,surround:"lid",contrast:.6,brightness:0,black:1,bleed:.4,paper:"white",texture:.3,lighting:.1,vignette:0,noise:.55,streaks:.3,dust:.4,speckle:.4,jpeg:.85},
  phone:   {label:"Phone photo", desc:"Perspective, uneven light",
    mode:"color",dpi:"150",rotation:2.2,keystone:.45,edge:1,surround:"desk",contrast:.35,brightness:-.05,black:.6,bleed:.3,paper:"white",texture:.4,lighting:.8,vignette:.6,noise:.45,streaks:0,dust:.1,speckle:0,jpeg:.75},
};
const PAPERS = {white:[.985,.982,.976], ivory:[.975,.953,.905], recycled:[.93,.918,.885], grey:[.945,.948,.953]};
const SURROUND = {lid:[.915,.915,.91], dark:[.15,.15,.16], desk:[.40,.32,.25]};

/* ---------- random ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const G = new Float32Array(65536);
{const r=mulberry32(99);for(let i=0;i<65536;i+=2){const u=Math.max(1e-9,r()),v=r(),m=Math.sqrt(-2*Math.log(u));G[i]=m*Math.cos(6.2831853*v);G[i+1]=m*Math.sin(6.2831853*v);}}

/* ---------- scan pipeline ---------- */
function blur(a,W,H,passes,tmp){
  for(let p=0;p<passes;p++){
    for(let y=0;y<H;y++){const o=y*W;tmp[o]=(3*a[o]+a[o+1])*.25;for(let x=1;x<W-1;x++)tmp[o+x]=(a[o+x-1]+2*a[o+x]+a[o+x+1])*.25;tmp[o+W-1]=(a[o+W-2]+3*a[o+W-1])*.25;}
    for(let y=0;y<H;y++){const o=y*W,u=y>0?o-W:o,d=y<H-1?o+W:o;for(let x=0;x<W;x++)a[o+x]=(tmp[u+x]+2*tmp[o+x]+tmp[d+x])*.25;}
  }
}
function mottle(W,H,rng,mm){
  const c=document.createElement("canvas");c.width=W;c.height=H;
  const x=c.getContext("2d",{willReadFrequently:true});x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";
  [[11,1],[3.2,.5],[.8,.32]].forEach(([cellMm,a],k)=>{
    const cell=Math.max(2,cellMm*mm),cw=Math.ceil(W/cell)+3,ch=Math.ceil(H/cell)+3;
    const s=document.createElement("canvas");s.width=cw;s.height=ch;const sx=s.getContext("2d");
    const id=sx.createImageData(cw,ch);for(let i=0;i<cw*ch;i++){const v=rng()*255|0;id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=v;id.data[i*4+3]=255;}
    sx.putImageData(id,0,0);x.globalAlpha=k?a:1;x.drawImage(s,-cell,-cell,cw*cell,ch*cell);
  });
  const d=x.getImageData(0,0,W,H).data,m=new Float32Array(W*H);
  for(let i=0,n=W*H;i<n;i++)m[i]=(d[i*4]-128)/48;
  return m;
}
const lum=c=>.299*c[0]+.587*c[1]+.114*c[2];

/* ---------- perspective warp ---------- */
// homography mapping the unit square (0,0),(1,0),(1,1),(0,1) onto quad P
function sqToQuad(P){
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=P;
  const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;
  const den=dx1*dy2-dx2*dy1,g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den;
  return [x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1];
}
function inv3(m){
  const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;
  return [A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
}
function warpPage(src,W,H,Q,d,sur,o){
  const S=src.getContext("2d",{willReadFrequently:true}).getImageData(0,0,src.width,src.height).data,SW=src.width,SH=src.height;
  const M=inv3(sqToQuad(Q));
  // edges as normalised lines, inside positive
  const cx=(Q[0][0]+Q[1][0]+Q[2][0]+Q[3][0])/4,cy=(Q[0][1]+Q[1][1]+Q[2][1]+Q[3][1])/4;
  const E=[];for(let k=0;k<4;k++){const [ax,ay]=Q[k],[bx,by]=Q[(k+1)%4];let nx=ay-by,ny=bx-ax;const l=Math.hypot(nx,ny);nx/=l;ny/=l;let c=-(nx*ax+ny*ay);if(nx*cx+ny*cy+c<0){nx=-nx;ny=-ny;c=-c;}E.push([nx,ny,c]);}
  const bg=[sur[0]*255,sur[1]*255,sur[2]*255];
  // desk: soft wood grain and uneven light, low frequency only
  let gr=null;
  if(o.desk){const r=o.rng,ph=[r()*6.28,r()*6.28,r()*6.28],f1=(2+r()*2)/H,f2=(9+r()*6)/H,wv=(1+r())/W;
    const G0=r()*65535|0,sl=(r()-.5)*.25;
    gr=(x,y)=>{const yy=y+x*sl;return 1+.12*Math.sin(6.283*(yy*f1+.5*Math.sin(6.283*x*wv+ph[0]))+ph[1])+.07*Math.sin(6.283*yy*f2*3.1+ph[2]+2.5*Math.sin(x*wv*7))+.05*G[(G0+(yy*.9|0))&65535]+.18*(1-x/W)*(1-y/H)-.12;};}
  for(let y=0;y<H;y++){const py=y+.5;
    for(let x=0;x<W;x++){const px=x+.5,p=(y*W+x)*4;
      let din=1e9,dsh=1e9;
      for(let k=0;k<4;k++){const e=E[k],v=e[0]*px+e[1]*py+e[2];if(v<din)din=v;const w=v-e[1]*o.shY;if(w<dsh)dsh=w;}
      const cov=din>=.5?1:din<=-.5?0:din+.5;
      let r=0,g=0,b=0;
      if(cov<1){const t=gr?gr(x,y):1,sg=o.shR*.5+.5,sh=dsh>0?o.shA:o.shA*Math.exp(-(dsh*dsh)/(2*sg*sg));
        const k=(1-sh)*t;r=bg[0]*k;g=bg[1]*k;b=bg[2]*k;}
      if(cov>0){
        const X=M[0]*px+M[1]*py+M[2],Y=M[3]*px+M[4]*py+M[5],Z=M[6]*px+M[7]*py+M[8];
        let u=X/Z*SW-.5,v=Y/Z*SH-.5;u=u<0?0:u>SW-1?SW-1:u;v=v<0?0:v>SH-1?SH-1:v;
        const iu=u|0,iv=v|0,fu=u-iu,fv=v-iv,iu1=iu<SW-1?iu+1:iu,iv1=iv<SH-1?iv+1:iv;
        const a0=(iv*SW+iu)*4,a1=(iv*SW+iu1)*4,a2=(iv1*SW+iu)*4,a3=(iv1*SW+iu1)*4;
        const w0=(1-fu)*(1-fv),w1=fu*(1-fv),w2=(1-fu)*fv,w3=fu*fv;
        r=r*(1-cov)+(S[a0]*w0+S[a1]*w1+S[a2]*w2+S[a3]*w3)*cov;
        g=g*(1-cov)+(S[a0+1]*w0+S[a1+1]*w1+S[a2+1]*w2+S[a3+1]*w3)*cov;
        b=b*(1-cov)+(S[a0+2]*w0+S[a1+2]*w1+S[a2+2]*w2+S[a3+2]*w3)*cov;
      }
      d[p]=r;d[p+1]=g;d[p+2]=b;d[p+3]=255;
    }
  }
}

function scan(src,s,seed,dpi,side){
  const W=src.width,H=src.height,mm=dpi/25.4,rng=mulberry32(seed),k200=dpi/200;
  const out=document.createElement("canvas");out.width=W;out.height=H;
  const ctx=out.getContext("2d",{willReadFrequently:true});
  const sur=SURROUND[s.surround]||SURROUND.lid;

  // geometry: the page is placed as a true perspective quad and resampled per pixel,
  // so edges and text lines come out identical (and smooth) in every browser.
  const ang=s.rotation*(.35+.65*rng())*(rng()<.5?-1:1)*Math.PI/180;
  const scale=1-s.edge*.035-s.keystone*.04;
  const ox=(rng()*2-1)*(s.edge*3.5*mm+s.keystone*.04*W), oy=(rng()*2-1)*(s.edge*3.5*mm+s.keystone*.03*H);
  const kk=s.keystone*.08;                                  // far (top) edge narrower
  const tilt=s.keystone*.035*(rng()*2-1);                   // one side nearer the camera
  const lean=s.keystone*.05*W*(rng()*2-1);                 // camera not centred over the page
  const hw=W/2,hh=H/2;
  let Q=[[-hw*(1-kk)+lean,-hh*(1-tilt)],[hw*(1-kk)+lean,-hh*(1+tilt)],[hw,hh*(1+tilt*.4)],[-hw,hh*(1-tilt*.4)]];
  const ca=Math.cos(ang),sa=Math.sin(ang);
  Q=Q.map(([x,y])=>[W/2+ox+(x*ca-y*sa)*scale,H/2+oy+(x*sa+y*ca)*scale]);
  // keep a margin so the page never touches the frame edge
  if(s.keystone>0){const m=(.012+.02*s.keystone)*Math.min(W,H);
   let x0=Math.min(...Q.map(q=>q[0])),x1=Math.max(...Q.map(q=>q[0])),y0=Math.min(...Q.map(q=>q[1])),y1=Math.max(...Q.map(q=>q[1]));
   const f=Math.min(1,(W-2*m)/(x1-x0),(H-2*m)/(y1-y0)),cx=(x0+x1)/2,cy=(y0+y1)/2;
   Q=Q.map(([x,y])=>[cx+(x-cx)*f,cy+(y-cy)*f]);
   x0=cx+(x0-cx)*f;x1=cx+(x1-cx)*f;y0=cy+(y0-cy)*f;y1=cy+(y1-cy)*f;
   const dx=x0<m?m-x0:x1>W-m?W-m-x1:0,dy=y0<m?m-y0:y1>H-m?H-m-y1:0;
   Q=Q.map(([x,y])=>[x+dx,y+dy]);}
  const img=ctx.createImageData(W,H),d=img.data,N=W*H;
  warpPage(src,W,H,Q,d,sur,{shA:s.edge>0?.18+.35*s.edge-s.keystone*.25:0,shR:(.4+s.edge*1.6+s.keystone*.8)*mm,shY:s.keystone*.6*mm,desk:s.surround==="desk",rng,mm});
  const color=s.mode==="color",bw=s.mode==="bw",C=color?3:1;
  const ch=[];for(let c=0;c<C;c++)ch.push(new Float32Array(N));
  if(color){const sat=.84;for(let i=0,p=0;i<N;i++,p+=4){const r=d[p]/255,g=d[p+1]/255,b=d[p+2]/255,l=.299*r+.587*g+.114*b;ch[0][i]=l+(r-l)*sat;ch[1][i]=l+(g-l)*sat;ch[2][i]=l+(b-l)*sat;}}
  else for(let i=0,p=0;i<N;i++,p+=4)ch[0][i]=(.299*d[p]+.587*d[p+1]+.114*d[p+2])/255;

  // optical softness + ink spread
  const sigma=(.3+s.bleed*.85)*k200, passes=Math.max(1,Math.round(sigma*sigma/.5));
  const tmp=new Float32Array(N);for(let c=0;c<C;c++)blur(ch[c],W,H,passes,tmp);
  // phone: shallow depth of field, softer toward the far (top) edge and a little at the near edge
  if(s.keystone>0){
    // computed at half resolution: the blur is wide and smooth, so this is visually identical and ~4x cheaper
    const fp=Math.max(1,Math.round(Math.pow(.65*k200,2)/.5)),wy=new Float32Array(H);
    for(let y=0;y<H;y++){const t=y/H;wy[y]=Math.min(1,s.keystone*(1.4*Math.pow(Math.max(0,1-t/.55),1.6)+.5*Math.max(0,(t-.88)/.12)));}
    const w2=(W+1)>>1,h2=(H+1)>>1,sm=new Float32Array(w2*h2),t2=new Float32Array(w2*h2);
    for(let c=0;c<C;c++){const a=ch[c];
      for(let y=0;y<h2;y++){const y0=2*y,y1=Math.min(H-1,y0+1);for(let x=0;x<w2;x++){const x0=2*x,x1=Math.min(W-1,x0+1);sm[y*w2+x]=(a[y0*W+x0]+a[y0*W+x1]+a[y1*W+x0]+a[y1*W+x1])*.25;}}
      blur(sm,w2,h2,fp,t2);
      for(let y=0;y<H;y++){const w=wy[y];if(!w)continue;let fy=y*.5-.25;fy=fy<0?0:fy>h2-1?h2-1:fy;const iy=fy|0,iy1=iy<h2-1?iy+1:iy,ty=fy-iy;
        for(let x=0;x<W;x++){let fx=x*.5-.25;fx=fx<0?0:fx>w2-1?w2-1:fx;const ix=fx|0,ix1=ix<w2-1?ix+1:ix,tx=fx-ix;
          const v=(sm[iy*w2+ix]*(1-tx)+sm[iy*w2+ix1]*tx)*(1-ty)+(sm[iy1*w2+ix]*(1-tx)+sm[iy1*w2+ix1]*tx)*ty,i=y*W+x;a[i]+=(v-a[i])*w;}}
    }
  }

  // tone curve LUT
  const bp=s.contrast*.22, wp=.97-s.contrast*.1, gam=1+s.bleed*.55+s.contrast*.3, floor=.03+(1-s.black)*.22;
  const LUT=new Float32Array(1025);
  for(let i=0;i<=1024;i++){let t=(i/1024-bp)/(wp-bp);t=t<0?0:t>1?1:t;LUT[i]=floor+(1-floor)*Math.pow(t,gam);}

  // paper, light, streaks
  const mot=s.texture>0?mottle(W,H,rng,mm):null;
  let P=PAPERS[s.paper]||PAPERS.white;if(!color){const l=lum(P);P=[l,l,l];}
  // phone: auto white balance never quite lands on neutral
  if(color&&s.keystone>0){const c=s.keystone*(.01+.025*rng())*(rng()<.75?1:-1);P=[P[0]*(1+c),P[1]*(1+c*.25),P[2]*(1-c)];}
  const colF=new Float32Array(W).fill(1),rowF=new Float32Array(H).fill(1),vx=new Float32Array(W),vy=new Float32Array(H);
  const shW=7*mm,shA=s.lighting*.17,grA=s.lighting*.06;
  for(let x=0;x<W;x++){const t=x/W;vx[x]=(t-.5)*(t-.5)*4;
    if(side===0)colF[x]=1-shA*Math.exp(-x/shW);else if(side===2)colF[x]=1-shA*Math.exp(-(W-x)/shW);else colF[x]=1-grA*t;}
  for(let y=0;y<H;y++){const t=y/H;vy[y]=(t-.5)*(t-.5)*4;
    if(side===1)rowF[y]=1-shA*Math.exp(-y/shW);else rowF[y]=1-grA*t;}
  const vig=s.vignette*.22;
  // phone-style light falloff: a soft off-centre hotspot
  const hx=.35+rng()*.3,hy=.3+rng()*.3;
  const streak=new Float32Array(W);
  if(s.streaks>0){let gi=(seed>>>3)&65535;
    for(let x=0;x<W;x++){streak[x]=G[(gi+x*7)&65535]*.0045*s.streaks;}
    const n=Math.round(s.streaks*7*(.5+rng()));
    for(let k=0;k<n;k++){const x0=rng()*W|0,w=Math.max(1,Math.round((1+rng()*2.5)*k200)),v=(rng()<.8?-1:.6)*(.02+rng()*.08)*s.streaks;
      for(let x=x0;x<Math.min(W,x0+w);x++)streak[x]+=v*(x===x0||x===x0+w-1?.6:1);}
  }
  const texA=s.texture*.03,grain=s.texture*.014,sig=s.noise*.028,br=s.brightness*.07;
  let ns=(seed|0)||1;
  for(let y=0;y<H;y++){
    const ry=rowF[y],vyy=vy[y],dy=y/H-hy;
    for(let x=0;x<W;x++){
      const i=y*W+x,p=i*4;
      const dx=x/W-hx;
      let L=colF[x]*ry*(1-vig*(vx[x]+vyy)*(1+(dx*dx+dy*dy)));
      ns^=ns<<13;ns^=ns>>>17;ns^=ns<<5;const g1=G[ns&65535];
      ns^=ns<<13;ns^=ns>>>17;ns^=ns<<5;const g2=G[ns&65535];
      const m=mot?mot[i]*texA:0;
      const base=L*(1+m+g1*grain);
      const n=g2*sig+streak[x]+br;
      if(bw){
        const v=ch[0][i]+g2*(.03+s.noise*.07)+m*1.5-(s.brightness*.12);
        const thr=.66+s.contrast*.12;
        const o=(v>thr?P[0]*Math.min(1,L+.05):floor*.6)*255;
        d[p]=d[p+1]=d[p+2]=o<0?0:o>255?255:o;
      } else if(color){
        for(let c=0;c<3;c++){
          ns^=ns<<13;ns^=ns>>>17;ns^=ns<<5;
          let o=(LUT[(ch[c][i]<0?0:ch[c][i]>1?1:ch[c][i])*1024|0]*P[c]*base+n+G[ns&65535]*sig*.35)*255;
          d[p+c]=o<0?0:o>255?255:o;
        }
      } else {
        const v=ch[0][i];let o=(LUT[(v<0?0:v>1?1:v)*1024|0]*P[0]*base+n)*255;
        d[p]=d[p+1]=d[p+2]=o<0?0:o>255?255:o;
      }
    }
  }
  ctx.putImageData(img,0,0);

  // dust, hair, toner speckle
  const area=(W/mm)*(H/mm)/62370;
  const dark=bw?"0,0,0":"28,26,24";
  const nSp=Math.round(s.dust*55*area*(.6+rng()*.8));
  for(let k=0;k<nSp;k++){const x=rng()*W,y=rng()*H,r=Math.max(.45,(.04+Math.pow(rng(),3)*.28)*mm),e=.5+rng()*.9;
    ctx.fillStyle=`rgba(${dark},${(.25+rng()*.6).toFixed(2)})`;ctx.beginPath();ctx.ellipse(x,y,r,r*e,rng()*3.14,0,6.283);ctx.fill();}
  const nh=s.dust>.15?(rng()<s.dust*.9?1:0)+(rng()<s.dust*.35?1:0):0;
  for(let k=0;k<nh;k++){const x=rng()*W,y=rng()*H,len=(4+rng()*12)*mm,a=rng()*6.283;
    ctx.strokeStyle=`rgba(${dark},${(.25+rng()*.3).toFixed(2)})`;ctx.lineWidth=Math.max(.7,.05*mm);ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x+Math.cos(a)*len*.4+(rng()-.5)*len*.5,y+Math.sin(a)*len*.4+(rng()-.5)*len*.5,x+Math.cos(a)*len*.7+(rng()-.5)*len*.4,y+Math.sin(a)*len*.7+(rng()-.5)*len*.4,x+Math.cos(a)*len,y+Math.sin(a)*len);ctx.stroke();}
  const nT=Math.round(s.speckle*1400*area);
  for(let k=0;k<nT;k++){const x=rng()*W,y=rng()*H,r=Math.max(.35,(.02+rng()*.05)*mm);
    ctx.fillStyle=`rgba(${dark},${(.12+rng()*.4).toFixed(2)})`;ctx.fillRect(x,y,r,r*(.6+rng()*.8));}
  return out;
}

/* Same JPEG bytes on every device: browsers ignore or remap toBlob/toDataURL quality
   (iOS Safari saves ~q93 when asked for q75), so the engine ships its own encoder. */
function encodeJPEG(cv,q){
  if(!root.platenJPEG)throw new Error("PlatenEngine.encodeJPEG needs jpeg-encoder.js loaded first");
  return root.platenJPEG(cv.getContext("2d").getImageData(0,0,cv.width,cv.height),Math.round(q*100));
}

root.PlatenEngine={scan,encodeJPEG,PRESETS,PAPERS,SURROUND,version:"1.0.0"};
})(typeof globalThis!=="undefined"?globalThis:self);
