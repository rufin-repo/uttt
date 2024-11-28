///<reference path='mcts2.ts'/>
///<reference path='uttt.ts'/>

const ctx :Worker = self as any;

importScripts('mcts2.js', 'uttt.js');

interface HostCommand
{
  cmd:      string,
  play1st:  number,  // used for 'NewGame' only.
  bigIdx:   number,
  smlIdx:   number,
} // interface HostCommand

let utstate = new UTTT;
let gameSolver = new MonteCarloTreeSearch(30000);  // The argument is the number of random games to try.
let prevMove:number = undefined;
let OToMoveStates:UTTT[]=[];    // for Back2 requests
function SendErrorMsg(msg:string) {
  ctx.postMessage({type:'Err:'+msg});
}

let BkgdSearchTimer=-1;
let StopBkgdSearchQ=true;
let BkgdSearchStartTime=0;
const MaxBkgdSearchTime = 300000; // 5 min limit. In case the player has gone away for good.
const MaxRootNodeVisit = 500000;  // don't make the AI too strong.
function DoBackgroundSearch()
{
  BkgdSearchTimer=-1;
  if (!StopBkgdSearchQ)
  {
    const timeNow = performance.now();
    if (BkgdSearchStartTime<=0) BkgdSearchStartTime=timeNow;

    const nVisitsBefore=gameSolver.NRootVisits();
    if (timeNow-BkgdSearchStartTime<MaxBkgdSearchTime &&
        utstate.PlayerToMove===2 &&
        nVisitsBefore<MaxRootNodeVisit)
    {
      gameSolver.FindBestMove(utstate, null,
        {numIter:1000, maxIter:MaxRootNodeVisit, maxTime:0, logMoves:false});
      // const nVisitsAfter=gameSolver.NRootVisits();
      // console.log("Bkgd searched:"+(performance.now()-BkgdSearchStartTime)+"ms, tries:"+nVisitsBefore+"->"+nVisitsAfter);
      BkgdSearchTimer=self.setTimeout(DoBackgroundSearch,1);
    }
    else
      BkgdSearchStartTime=0;
  }
} // DoBackgroundSearch()

function SetupBkgdSearch() {
  if (!utstate.mGameOver && utstate.PlayerToMove===2) {
    StopBkgdSearchQ=false;
    BkgdSearchStartTime=0;
    if (BkgdSearchTimer===-1) {
      BkgdSearchTimer=self.setTimeout(DoBackgroundSearch, 1);
    }
  }
  else {
    StopBkgdSearchQ=true;
    if (BkgdSearchTimer!==-1) {
      self.clearTimeout(BkgdSearchTimer);
      BkgdSearchTimer=-1;
    }
  }
} // SetupBkgdSearch()

function SendComputedMoveCertaintyToHost(certainty:number) {
  ctx.postMessage({type:'XCertainty', percent:Math.floor(certainty*100+0.5)});
} // SendComputedMoveCertaintyToHost()

ctx.addEventListener('message', function(e: MessageEvent) {
  let data = e.data as HostCommand;
  console.log("c4worker got ["+ data.cmd + "] cmd.");
  switch (data.cmd) {
  case 'GameState':
    utstate.SendGameStateToHost();
    break;
  case 'OBackTrack':
    if (OToMoveStates.length>0) {
      utstate = OToMoveStates.pop();
      gameSolver.DiscardOldTree();
      prevMove = undefined; // Restart MCTS from scratch because we would not have the earlier upper trees.
      utstate.SendGameStateToHost();
    }
    else
      SendErrorMsg('No more previous moves.');
    break;
  case 'NewGame':
    {
      OToMoveStates.length=0;
      utstate.ResetGame();
      if (data.play1st===1) utstate.mPlayerToMove=1;
      else if (data.play1st===2) utstate.mPlayerToMove=2;
      utstate.SendGameStateToHost();
      SendComputedMoveCertaintyToHost(0.5); // Send neutral confidence level.

      if (utstate.PlayerToMove===1) { // Computer first. Start searching immediately.
        let moveInfo = gameSolver.FindBestMove(utstate);
        utstate.MakeMove(moveInfo.move);
        prevMove = moveInfo.move;
        SendComputedMoveCertaintyToHost(moveInfo.certainty);
      }
    }
    break;
  case 'MakeMove':
  case 'MakeAutoMove':
    if (utstate.PlayerToMove===2 && utstate.HasMovesQ()) {
      let move=-1;
      if (data.cmd==='MakeAutoMove') {
        move = gameSolver.FindBestMove(utstate, prevMove).move;
      }
      else if (data.bigIdx>=0 && data.bigIdx<9 &&
               data.smlIdx>=0 && data.smlIdx<9)
      {
        move = data.bigIdx*10 + data.smlIdx;
      }
      OToMoveStates.push(utstate.Clone());  // back up the game state before O's new move.
      if (move>=0)
      {
        utstate.MakeMove(move);
        prevMove = move;
        utstate.SendGameStateToHost();
      }
    }
    if (utstate.PlayerToMove===1 && utstate.HasMovesQ()) {
      let moveInfo = gameSolver.FindBestMove(utstate, prevMove);
      utstate.MakeMove(moveInfo.move);
      prevMove = moveInfo.move;
      SendComputedMoveCertaintyToHost(moveInfo.certainty);
    }
    break;
  } // switch (data.cmd)

  utstate.SendGameStateToHost();
  SetupBkgdSearch();
});
