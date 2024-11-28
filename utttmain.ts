let uTTTWorker = new Worker('utttworker.js');

uTTTWorker.onerror = (e:ErrorEvent)=>{
  console.log(e);
};

function byId(id:string) : HTMLElement { return document.getElementById(id) as HTMLElement; }

interface uTTTMsg
{
  type:         string;
  percent:      number;     // evaluation progress
  targetCells:  number,     // 1 bit per big cell. On (1) means targetable.

  smlCellState: number[],   // [0-8], 2 bits per small cell
  bigCellState: number,     // 2 bits per big cell (1:X won that cell, 2:O won that cell)

  lastPlayer:   number,     // 1 or 2
  lastBigIdx:   number,     // 0-8
  lastSmlIdx:   number,     // 0-8

  gameover:     boolean,
  winner:       number,
} // interface uTTTMsg


class UI
{
  static CmdLine  : HTMLDivElement|null = null;
  static BoardDiv : HTMLDivElement|null = null;
  static BoardCanv: HTMLCanvasElement|null = null;
  static Auto1Btn : HTMLButtonElement|null = null;
  static NewGmBtn : HTMLButtonElement|null = null;
  static Back2Btn : HTMLButtonElement|null = null;
  static CertaintyDisp: HTMLTableRowElement|null = null;

  static StatusMsg: string = '';

  static GameOverQ:     boolean  = true;
  static Winner:        number   = 0;
  static PlayerToMove:  number   = 1;
  static SmlCellState:  number[] = [0,0,0,0,0,0,0,0,0];
  static BigCellState:  number   = 0;
  static TargetableCells:number  = 0x1ff; //1<<4;
  static LastSmlIdx:    number   =-1;
  static LastBigIdx:    number   =-1;

  // static PlayerMoveCmd(e:InputEvent)
  // {
  //   if (e.target===UI.CmdLine) {
  //     let str = UI.CmdLine.value;
  //     let col1=-1;
  //     let col2=0;
  //     let pwr=0;
  //     let mvparts = str.match(/([0-9]),?([0-9])/);
  //     if (mvparts!==null) {
  //       let bigidx= +mvparts[1];
  //       let smlidx= +mvparts[2];
  //       if (bigidx>=0 && bigidx<9 && smlidx>=0 && smlidx<9 &&   // sanity checks
  //           UI.PlayerToMove===2 &&
  //           (UI.TargetableCells&(1<<bigidx))!==0 &&            // big cell targetable?
  //           ((UI.SmlCellState[bigidx]>>(smlidx*2))&3)===0)   // small cell empty?
  //       {
  //         uTTTWorker.postMessage({
  //             cmd:    'MakeMove',
  //             bigIdx:  +mvparts[1],
  //             smlIdx:  +mvparts[2],
  //           });
  //         UI.CmdLine.disabled=true;
  //         UI.PlayerToMove=3-UI.PlayerToMove;
  //       }
  //     }
  //     else if (str.toLowerCase()==='auto' || str.toLowerCase()==='a') {
  //       UI.AutoPlayOForOnce();
  //     }
  //   }
  //   UI.CmdLine.value='';
  // } // PlayerMoveCmd()

  static AutoPlayOForOnce() {
    if (UI.PlayerToMove===2) {
      uTTTWorker.postMessage({
        cmd:  'MakeAutoMove',
      });
      UI.UpdateUI('Eval for \u25ef', false);
    }
  } // AutoPlayOForOnce()

  static BackTrack2Moves() {
    if (UI.PlayerToMove===2) {
      uTTTWorker.postMessage({cmd:'OBackTrack'});
      UI.UpdateUI("Back tracking", true);
    }
  } // BackTrack2Moves()

  static StartNewGame() {
    if (UI.PlayerToMove===2 || UI.GameOverQ) {
      UI.UpdateUI("New Game", true);
      uTTTWorker.postMessage({cmd:'NewGame', play1st: 2}); // 2 means 'O', i.e. human player.
    }
  } // StartNewGame()

  static DrawMark(ctx:CanvasRenderingContext2D,
    x:number, y:number, sz:number, mark:number,
    addBgFillQ:boolean)
  {
    const m = sz*0.15;
    if (addBgFillQ) {
      ctx.fillStyle="rgba(255,255,0, 0.3)";
      ctx.fillRect(x, y, sz, sz);
    }

    if (mark===1) {
      ctx.beginPath();
      ctx.moveTo(x+m, y+m); ctx.lineTo(x+sz-m, y+sz-m);
      ctx.moveTo(x+sz-m, y+m); ctx.lineTo(x+m, y+sz-m);
      ctx.stroke();
    }
    else if (mark===2) {
      ctx.beginPath();
      ctx.moveTo(x+sz-m, y+sz/2);
      ctx.arc(x+sz/2, y+sz/2, sz/2-m, 0, Math.PI*2);
      ctx.stroke();
    }
  } // DrawMark()

  private static _1bitWinPatts = [
    0x049,  // lft vert
    0x092,  // mid vert
    0x124,  // rgt vert
    0x007,  // top horz
    0x038,  // mid horz
    0x1c0,  // bot horz
    0x111,  // -ve diag
    0x054,  // +ve diag
  ];
  private static _2bitWinPatts = [
    0x01041,  // lft vert
    0x04104,  // mid vert
    0x10410,  // rgt vert
    0x00015,  // top horz
    0x00540,  // mid horz
    0x15000,  // bot horz
    0x10101,  // -ve diag
    0x01110,  // +ve diag
  ];


  static DrawBoard()
  {
    if (UI.BoardCanv && UI.SmlCellState && UI.SmlCellState.length===9)
    {
      let w = UI.BoardCanv.width;
      let h = UI.BoardCanv.height;
      let r = Math.min(w, h)/2-2;
      let t = h/2-r;
      let l = w/2-r;
      const bigCellSz = (r*2)/3;
      const bcm=bigCellSz/20;  // big cell margin
      const smlCellSz = (bigCellSz-2*bcm)/3;

      let ctx: CanvasRenderingContext2D = UI.BoardCanv.getContext("2d") as CanvasRenderingContext2D;
      ctx.clearRect(0,0,w,h);
      ctx.lineCap = 'round';

      let bigWinPatt=0;
      if (UI.GameOverQ && (UI.Winner===1 || UI.Winner===2)) {
        const winnerBigMarks = (UI.BigCellState>>(UI.Winner-1))&0x15555;
        for (let patt of UI._2bitWinPatts)
          if ((winnerBigMarks&patt)===patt) {
            bigWinPatt=patt;
            break;
          }
      }

      for (let bigidx=0; bigidx<9; bigidx++) {
        let bl = l + (bigidx%3)*bigCellSz + bcm;
        let bt = t + Math.floor(bigidx/3)*bigCellSz + bcm;
        if ((UI.TargetableCells>>bigidx)&1) { // targetable big cell
          ctx.fillStyle = "rgba(255,255,0, 0.3)";
          ctx.fillRect(bl, bt, bigCellSz-2*bcm, bigCellSz-2*bcm);
        }

        // If this big cell has a winner, draw it in the background.
        const bcWinner = (UI.BigCellState>>(2*bigidx))&3;
        let bcDrawnQ = false;
        if (bcWinner) {
          const inBigWinPattQ = ((bigWinPatt>>(2*bigidx))&3)===1;
          ctx.strokeStyle = bcWinner===1 ?
            (inBigWinPattQ ? "rgba(255,0,0,0.6)" : "rgba(255,0,0,0.5)") :
            (inBigWinPattQ ? "rgba(0,0,255,0.6)" : "rgba(0,0,255,0.5)");
          ctx.lineWidth = inBigWinPattQ ? bigCellSz/6 : bigCellSz/12;
          UI.DrawMark(ctx, bl,bt,bigCellSz-2*bcm, bcWinner, false);
        }
        else {
          if ((((UI.SmlCellState[bigidx]>>1)&0x15555) |
               ((UI.SmlCellState[bigidx]   )&0x15555))===0x15555) // fully filled.
            bcDrawnQ=true;
        }

        // Draw the individual small cells
        for (let smlidx=0; smlidx<9; smlidx++) {
          let sl = bl + (smlidx%3)*smlCellSz;
          let st = bt + Math.floor(smlidx/3)*smlCellSz;
          let mark = (UI.SmlCellState[bigidx]>>(2*smlidx))&3;
          if (mark) {
            ctx.strokeStyle = (bcWinner || bcDrawnQ) ? "rgba(0,0,0,0.05)" :
              (mark===1 ? "rgb(255,128,128)" : "rgb(100,100,255)");
            const wasLastMoveQ =UI.LastSmlIdx===smlidx && UI.LastBigIdx===bigidx;
            ctx.lineWidth = wasLastMoveQ ? smlCellSz/6 : smlCellSz/20;
            UI.DrawMark(ctx, sl,st,smlCellSz, mark, wasLastMoveQ);
          }
        } // for (smlidx)

        // Draw the small cell grid lines.
        ctx.strokeStyle="#666";
        ctx.lineWidth=1; //bigCellSz/90;
        ctx.lineCap="round";
        for (let g=1; g<3; g++) {
          ctx.beginPath();
          ctx.moveTo(bl+g*smlCellSz, bt); ctx.lineTo(bl+g*smlCellSz, bt+bigCellSz-2*bcm);
          ctx.moveTo(bl, bt+g*smlCellSz); ctx.lineTo(bl+bigCellSz-2*bcm, bt+g*smlCellSz);
          ctx.stroke();
        }

      } // for (bigidx)
    }
    else
      throw "Internal error.";
  } // DrawBoard()

  static OnBoardClick(e:MouseEvent)
  {
    if (e.target instanceof HTMLCanvasElement &&
        e.target===UI.BoardCanv &&
        !UI.GameOverQ && UI.PlayerToMove===2)
    {
      let pxlScl = window.devicePixelRatio;
      let bdr = e.target.getBoundingClientRect();
      let cLeft = bdr.left;
      let cTop  = bdr.top+document.body.scrollTop;

      const w = UI.BoardCanv.width;
      const h = UI.BoardCanv.height;
      const r = Math.min(w, h)/2-2;  // half size of big board
      const bd_t = h/2-r;
      const bd_l = w/2-r;
      const bigCellSz = (r*2)/3;
      const bcm=bigCellSz/20;  // big cell margin
      const smlCellSz = (bigCellSz-2*bcm)/3;

      const posX = (e.pageX - cLeft)*pxlScl - bd_l;
      const posY = (e.pageY - cTop)*pxlScl - bd_t;

      if (posX>=0 && posX<(2*r) &&
          posY>=0 && posY<(2*r))
      {
        const bigx = Math.floor(posX/bigCellSz);
        const bigy = Math.floor(posY/bigCellSz);
        const bl = bigx*bigCellSz + bcm;
        const bt = bigy*bigCellSz + bcm;
        const bigIdx = bigy*3+bigx;
        if (posX>=bl && posX<bl+bigCellSz-bcm*2 &&
            posY>=bt && posY<bt+bigCellSz-bcm*2 &&
            bigIdx>=0 && bigIdx<9 &&
            (UI.TargetableCells>>bigIdx)&1)
        {
          const smlx = Math.floor((posX-bl)/smlCellSz);
          const smly = Math.floor((posY-bt)/smlCellSz);
          const smlIdx = smly*3+smlx;
          if (((UI.SmlCellState[bigIdx]>>(smlIdx*2))&3)===0) {
            uTTTWorker.postMessage({
              cmd:"MakeMove",
              bigIdx:bigIdx,
              smlIdx:smlIdx});
            UI.PlayerToMove = 3-UI.PlayerToMove;
          }
          else {
          }
        }
        else {
        }
      }
    } // if (!GameOverQ && PlayerToMove===2)
  } // OnBoardClick()

  static statusResetTimer = -1;
  static TempStatusMsg(msg:string, duration:number=2000)
  {
    if (UI.CmdLine) {
      UI.CmdLine.innerText = msg;
      if (UI.statusResetTimer!==-1) window.clearTimeout(UI.statusResetTimer);
      UI.statusResetTimer = window.setTimeout(()=>{
        UI.statusResetTimer=-1;
        if (UI.CmdLine)
          UI.CmdLine.innerText = UI.StatusMsg;
      }, duration);
    }
  } // TempStatusMsg()

  static UpdateUI(statusMsg:string, enableBtnsQ: boolean) {
    if (statusMsg!==null) UI.StatusMsg = statusMsg;
    if (UI.CmdLine) {
      if (statusMsg!==null && UI.statusResetTimer===-1) // do not change the msg if a temp msg is still being displayed (..Timer!=-1)
        UI.CmdLine.innerText = statusMsg;
      // UI.CmdLine.disabled = UI.GameOverQ || !enableBtnsQ || UI.PlayerToMove!==2;
    }

    if (UI.Auto1Btn) UI.Auto1Btn.disabled = UI.GameOverQ || !enableBtnsQ;
    if (UI.Back2Btn) UI.Back2Btn.disabled = !enableBtnsQ;
    if (UI.NewGmBtn) UI.NewGmBtn.disabled = !enableBtnsQ;
  } // UpdateUI()

  static UpdateComputerConfidence(percent:number)
  {
    if (UI.CertaintyDisp) {
      let f = Math.max(0,Math.min(1,percent/100.0));
      let ctopR:number; let ctopG:number; let ctopB:number;
      if (f>0.5) {
        ctopR = 200; ctopG = 210;  ctopB = 255;
        f=1-f;  // convert f from [0.5..1] to [1..0.5]
      }
      else {
        ctopR = 255; ctopG = 180;  ctopB = 180;
        f+=0.5; // convert f from [0..0.5] to [0.5..1]
      }
      const stop2 = Math.floor(100+25*(1-f));  // the position of the lower color stop (from 75% to 125%)

      // f=0->ctop,  f=1->gray
      let ctop = Math.floor(((1-f)*ctopR+210*(f))/16).toString(16)+
                 Math.floor(((1-f)*ctopG+210*(f))/16).toString(16)+
                 Math.floor(((1-f)*ctopB+210*(f))/16).toString(16);
      UI.CertaintyDisp.style.background =
        'linear-gradient(#'+ctop+',#FFF '+stop2+'%)'
    } // if (CertaintyDisp)
  } // UpdateComputerConfidence()

  static OnWorkerMessage(e:MessageEvent)
  {
    let d:uTTTMsg = e.data as uTTTMsg;
    console.log("Worker msg: "+d.type);
    switch (d.type) {
    case 'XCertainty':
      if (typeof(d.percent) ==='number') {
        UI.UpdateComputerConfidence(d.percent);
      }
      break;
    case 'GameState':
      UI.BigCellState    = d.bigCellState;
      UI.TargetableCells = d.targetCells;
      UI.SmlCellState    = d.smlCellState;
      UI.LastBigIdx      = d.lastBigIdx;
      UI.LastSmlIdx      = d.lastSmlIdx;
      UI.GameOverQ       = d.gameover;
      UI.Winner          = d.winner;
      UI.PlayerToMove    = 3-d.lastPlayer;

      UI.DrawBoard();

      if (d.smlCellState && d.smlCellState.length===9) {
        if (!d.gameover && d.lastPlayer===1) {
          UI.UpdateUI("\u25ef's turn.", true);
          // UI.CmdLine.disabled = false;
          // UI.CmdLine.focus();
        }
        else {
          UI.UpdateUI(
            UI.GameOverQ        ? (UI.Winner===1 ? "\u2573 has won." : d.winner===2 ? "You're the CHAMPION !!" : "Drawn. Well done!") :
            UI.PlayerToMove===1 ? "\u2573 thinking" :
                                  "\u25ef's turn.", true);
        }
      }
      else {
        UI.TempStatusMsg("Ill formed GameState message.");
      }
      break;

    case 'Progress':
      UI.UpdateUI((UI.PlayerToMove===1 ? "\u2573 thinking " : "Eval for \u25ef ") + d.percent.toFixed(1) + '%', false);
      break;

    default:
      if (d.type.substr(0,4)==='Err:')
        UI.TempStatusMsg(d.type);
      else
        UI.TempStatusMsg("Unknown worker message received.");
      break;
    } // switch ()
  } // UTG.OnWorkerMessage()

  static onResizeTimer=-1;
  static OnResizeDebouncer()  // Delay canvas pixel-res resizing until the resizing guesture stabilizes.
  {
    if (UI.onResizeTimer!==-1) {
      window.clearTimeout(UI.onResizeTimer); // was delaying, cancel the previous delay callback first.
    }
    UI.onResizeTimer=window.setTimeout(UI.onResize, 300); // 300ms pause
  }
  private static onResize() // This is the actual "on resize" processing.
  {
    UI.onResizeTimer=-1;
    UI.resizeBoardCanv()
    UI.DrawBoard();
  } // OnResize()
  private static resizeBoardCanv() {  // Helper function: update the resolution of the board canvas.
    if (UI.BoardDiv && UI.BoardCanv) {
      let scl = window.devicePixelRatio;
      UI.BoardCanv.width=Math.floor(window.innerWidth*scl);
      UI.BoardCanv.height=Math.floor((window.innerHeight-40)*scl);
      UI.BoardCanv.style.height = (window.innerHeight-40).toString()+"px";
      UI.BoardCanv.style.width = (window.innerWidth).toString()+"px";
    }
  } // resizeBoardCanv()

  private static SetupBtn(id:string, onclick:(e:Event)=>void): HTMLButtonElement|null
  {
    let btn = byId(id);
    if (btn && btn instanceof HTMLButtonElement) {
      if (onclick) btn.addEventListener('click', onclick);
      return btn;
    }
    return null;
  } // SetupBtn()

  static InitPage()
  {
    UI.CertaintyDisp = byId('statusrow') as HTMLTableRowElement;
    UI.CmdLine = byId('cmdline') as HTMLDivElement;
    UI.BoardDiv = byId('boardDiv') as HTMLDivElement;
    UI.BoardCanv = byId('board') as HTMLCanvasElement;
    let btn = byId('autoBtn');
    if (btn && btn instanceof HTMLButtonElement) {
      btn.addEventListener('click', ()=>{
        if (UI.PlayerToMove===2 /*&& !UI.CmdLine.disabled*/)
          uTTTWorker.postMessage({cmd:'MakeAutoMove'});
      });
    }
    UI.Auto1Btn = UI.SetupBtn('auto1Btn', UI.AutoPlayOForOnce);
    UI.Back2Btn = UI.SetupBtn('back2Btn', UI.BackTrack2Moves);
    UI.NewGmBtn = UI.SetupBtn('newGameBtn', UI.StartNewGame);

    UI.resizeBoardCanv();
    UI.DrawBoard();

    // UI.CmdLine.disabled=true;
    // UI.CmdLine.addEventListener('change', UI.PlayerMoveCmd);

    UI.BoardCanv.addEventListener("mouseup", UI.OnBoardClick);

    window.addEventListener('resize', UI.OnResizeDebouncer);

    for (let i=0; i<=100; i+=10)
      UI.UpdateComputerConfidence(i);

    UI.UpdateComputerConfidence(50); // neutral confidence level.

    uTTTWorker.postMessage({cmd:'NewGame'});
  } // InitPage()
} // class UI

uTTTWorker.addEventListener('message', UI.OnWorkerMessage);

interface Window { [key: string]: any }
window["InitPage"]=UI.InitPage;
