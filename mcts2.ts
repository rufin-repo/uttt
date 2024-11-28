//#define WEBWORKER

// Generic Monte Carlo Tree Search Algorithm
// UCB computation is based on Hoeffding's inequality for bounded random variables:
//  Let Xbar be the sample mean = (X1+X2+X3+X4..+Xn)/n
//  P(Xbar - E[Xbar] >= t)  <=  2 e^(-ct^2)
//
// Chaslot, G. M. B., Winands, M. H., & van Den Herik, H. J. (2008).
//     Parallel monte-carlo tree search. In Computers and Games (pp. 60-71).
//     Springer Berlin Heidelberg.

/*===============================================================*\
    _____               ______       __
   / ___/__ ___ _  ___ / __/ /____ _/ /____
  / (_ / _ `/  ' \/ -_)\ \/ __/ _ `/ __/ -_)
  \___/\_,_/_/_/_/\__/___/\__/\_,_/\__/\__/

  Abstract GameState base class to be specialized for each game
\*===============================================================*/
//#ifndef WEBWORKER
//# export
//#endif WEBWORKER
abstract class GameState {
  abstract get PlayerToMove():number;         // The player number who is going to play now. 1 or 2.
  abstract MakeMove(move: any):void;          // Make the given move and update the game state.
  abstract MakeARandomMove():void;            // Randomly performs a valid move and update the game state.
  abstract HasMovesQ() :boolean;              // true if there are still valid moves to make for
  abstract GetMoves() : any[];                // Returns an array of valid moves from the current game state.
  abstract GameResult(player:number): number; // Return a value for the current game state from the perspective of 'player'. E.g. 0: player lost, 0.5:drawn, 1:player won
  abstract Clone() : GameState;               // Make a copy of the game state object (must not share mutable state-dependent data).
  abstract SameAs(state:GameState):boolean;   // Check for the equivalence of two state objects (checks contents not pointers!)

  abstract UpdateProgress(_percent:number) :void;   // Update a progress bar etc... Could do nothing.
  MoveStr(move: any):string    // Returns a displayable string for the given move identifier. (For debugging.)
  {
    return move.toString();             // Default to JS toString().
  }
} // class GameState //




//---------------------------------------------------------------
// Gnode: game tree nodes. This class is private to this module.
//---------------------------------------------------------------
class GNode
{
  mMove:any;  // GameState implementation dependent opaque info for specifying a game move.
  mParent:GNode;
  mUntriedMoves:any[];
  mChildren:GNode[];
  mPlayerToMove:number; // 1 or 2
  mValue:number;  // accumulated rewards of all previous visits to this GNode.
  mNVisits:number;
  mUCB:number;    // Upper Confidence Bound = avg_value_of_all_children_nodes + 2*sqrt(ln(parent.NVisits)/this.NVisits)

	constructor (state: GameState|GNode, parent:GNode=null, move:any=null) {
    if (state instanceof GNode) { // copy constructor
      this.mParent = state.mParent;
      this.mMove = state.mMove;
      this.mChildren = state.mChildren.slice(0);
      this.mValue = state.mValue;
      this.mUCB = state.mUCB;
      this.mUntriedMoves = state.mUntriedMoves.slice(0);
      this.mPlayerToMove = state.mPlayerToMove;
    }
    else {
      this.mParent = parent;
      this.mMove = move;
      this.mChildren = [];
      this.mValue = 0;
      this.mNVisits = 0;
      this.mUCB = 0;
      this.mUntriedMoves = state.GetMoves();
      this.mPlayerToMove = state.PlayerToMove;
    }
  } // constructor() //

  get PlayerToMove() {return this.mPlayerToMove;}
  get NVisits() {return this.mNVisits;}
  get Value() {return this.mValue;}
  get ChildNodes() : GNode[] {return this.mChildren;}
  get Parent() : GNode {return this.mParent;}

  TurnIntoIndependentTree() : GNode {
    if (this.mParent) {
      let siblings = this.mParent.mChildren;
      for (let i=siblings.length-1; i>=0; i--) {
        if (siblings[i]===this) {   // Found itself in sibling list.
          siblings[i]=null;         // Reduce reference count to this GNode.
          siblings.splice(i,1);     // Remove this from siblings list.
          this.mParent=null;        // Sever tie to parent (so that it could be garbage collected.)
          // this.mMove = null; // keep this for easier debugging
          return this;
        }
      }
      throw "Bad parent.";  // could not found 'this' in mParent's mChildren list???
    }
    return this;
  } // GNode()::TurnIntoIndependentTree()

  GetMove() {return this.mMove;}
  HasUntriedMovesQ(): boolean { return this.mUntriedMoves.length>0; }

  AccValue(val:number)
  {
    this.mValue+=val;
    this.mNVisits++;
  } // GNode::AccValue()

  GetRandomUntriedMoveIndex() : number // -1 if
  {
    return (this.mUntriedMoves) ? Math.floor(Math.random()*this.mUntriedMoves.length) : -1;
  } // GNode:GetRandomUntriedMoveIndex

  GetRandomUntriedMove() : any
  {
    let moveIdx = this.GetRandomUntriedMoveIndex();
    return moveIdx>=0 ? this.mUntriedMoves[moveIdx] : undefined;
  } // GNode::GetRandonUntriedMove()

  FindMaxUCBChild():GNode
  {
    let bestChild = null;
    if (this.mChildren) {
      // calc UCB for all children first
      for (let child of this.mChildren) {
        child.mUCB = child.mValue/child.mNVisits +
          Math.sqrt(2 * Math.log(this.mNVisits)/child.mNVisits);
      } // for (child)
      let maxUCB = -9e99;
      for (let child of this.mChildren) {
        if (child.mUCB>maxUCB) {
          bestChild=child;
          maxUCB = child.mUCB;
        }
      } // for (i)
    }
    return bestChild;
  } // GNode::FindMaxUCBChild()

  NewChildFromRandomUntriedMove(gstate:GameState) : GNode
  {
    let child :GNode = this;
    let mvIdx = this.GetRandomUntriedMoveIndex();
    if (mvIdx>=0) {
      let move = this.mUntriedMoves[mvIdx];
      gstate.MakeMove(move);
      child = new GNode(gstate, this, move);
      this.mChildren.push(child);
      this.mUntriedMoves.splice(mvIdx,1);
    }
    return child;
  } // GNode::NewChildFromRandomUntriedMove()

	// ToString() : string
  // {
  //   return '[P'+(3-this.mPlayerToMove)+' M:'+this.mMoveSpec+ ' V:'+this.mValue+ ' N:'+this.mNVisits + ' m:'+this.mUntriedMoves.length+']';
  // }
} // class GNode

//#ifndef WEBWORKER
//# export
//#endif WEBWORKER
class MonteCarloTreeSearch
{
  mMaxIterations: number;
  mTimeLimit: number;
  // mGameStateConstructor: ()=>GameState;
  mPrevRootNode: GNode;  // For continuing the search from reusable part of the previous game tree.
  mPrevRootState: GameState;

  constructor(maxIter:number) //gameStateConstructor:()=>GameState)
  {
    // this.mGameStateConstructor = gameStateConstructor;
    this.mTimeLimit = -1.0; // no time limit
    this.mMaxIterations = maxIter;
    this.mPrevRootNode = null;
    this.mPrevRootState = null;
  } // constructor() //

  FindOldNode(currState: GameState, latestMove:any) : GNode
  {
    if (this.mPrevRootState) {
      if (currState.SameAs(this.mPrevRootState)) {  // this could happen if the program is playing against itself.
        return this.mPrevRootNode;
      }
      else if (latestMove!==undefined) {
        let oldNode:GNode = this.mPrevRootNode;
        for (let child of oldNode.ChildNodes) {
          if (child.GetMove()===latestMove) {
            let childState = this.mPrevRootState.Clone();
            childState.MakeMove(latestMove);
            if (childState.SameAs(currState)) { // This child node corresponds to the currState.
              let subTree = child.TurnIntoIndependentTree();  // Sever ties with parent and siblings
              this.mPrevRootNode = null;        // Free the entire old game tree.
              this.mPrevRootState = null;       // We don't need this anymore.
              return subTree;
            }
          }
        }
      }
    }
    this.mPrevRootNode = null; // free the entire old game tree, if any.
    return null;
  } // FindOldNode()

  FindBestMove(startState:GameState, latestMove:any=undefined) : any
  {
    let availMoves = startState.GetMoves();
    let player = startState.PlayerToMove;
    let bestMove:any = null;
    let rootNode = this.FindOldNode(startState, latestMove);
    if (rootNode===null) rootNode = new GNode(startState);

    if (availMoves.length===1)
      bestMove=availMoves[0];
    else if (availMoves.length>1) {
//#ifdef WEBWORKER
      let startTime = performance.now();
      let timeSinceLastProgress=0;
//#endif WEBWORKER

      // Each iteration would explore a new stochastically picked path down the game tree
      // till the end.
      for (let i=0; i<this.mMaxIterations; i++) {
        let node = rootNode;
        // Make a copy of the startState for trying out a complete game
        // starting with the next untried move or the most promising move
        // and play it all the way till the end.
        let state = startState.Clone();

        // Step 1: If we have tried each move at least once, we could
        //         begin exploring from the most promising leaf node
        while (!node.HasUntriedMovesQ() && node.ChildNodes.length) {
          node = node.FindMaxUCBChild(); // move down to the most promising child node
          state.MakeMove(node.GetMove());
        }

        // Step 2: If we have not reached the end game yet, randomly
        //         pick an untried move and add a new child-node
        //         based on the picked move.
        // (This is the "Expansion" step.)
        if (node.HasUntriedMovesQ()) {
          node = node.NewChildFromRandomUntriedMove(state);
        }

        // Step 3: Randomly play the game till the end. (The "Rollout" step.)
        while (state.HasMovesQ()) {
          state.MakeARandomMove();
        }

        // Step 4: Back-propagate result up the tree to the root.
        let result1 = state.GameResult(1);
        // let result2 = state.GameResult(2);
        // if (result1+result2!==1) {
        //   result1 = state.GameResult(1);
        //   result2 = state.GameResult(2);
        //   throw "Something went wrong";
        // }
        while (node!==null) {
          // Note that we are trying to record the game value
          // of the node, reached by the last player's move.
          // Therefore result2 would be taken if PlayerToMove is 1
          // and vice versa.
          node.AccValue(node.PlayerToMove===1 ? (1-result1) : result1);
          node = node.mParent;
        }
//#ifdef WEBWORKER
        let timeNow = performance.now()-startTime;
        if (timeNow - timeSinceLastProgress>500) {
          //console.log('calling UpdateProgress('+(i*100/this.mMaxIterations).toFixed(1)+')');
          startState.UpdateProgress(i*100/this.mMaxIterations);
          timeSinceLastProgress=timeNow;
        }
//#endif WEBWORKER
      } // for (i)

      let nGamesPlayed = rootNode.NVisits;
      let bestRate = -1;
      let bestChild:GNode = null;
      for (let child of rootNode.ChildNodes) {
        let val = child.Value;
        let n   = child.NVisits;
        let rate = (val+1)/(n+2);  // The +1 and +2 are corrections for Beta distribution.
        let newBestQ=false;
        if (rate>bestRate) {
          bestChild = child;
          bestRate = rate;
          newBestQ=true;
        }
        console.log("Move: "+startState.MoveStr(child.GetMove()) +
          " ("+ (n/nGamesPlayed*100).toFixed(1)+ "% played)"+
          " ("+ (100*rate).toFixed(1) + "% wins)" +
          (newBestQ ? "*" : ""));
          //" ("+ Math.floor(100*val/n+0.5) + "% wins)");
      } // for (child)

      bestMove = bestChild.GetMove();
    } // else if (availMoves.length>1) ..

    console.log((player===1 ? "X's" : "O's")+" best move: "+startState.MoveStr(bestMove));
    console.log('');

    this.mPrevRootState = startState.Clone();
    this.mPrevRootNode = rootNode;
    return bestMove;
  } // FindBestMove() //
} // class MonteCarloTreeSearch

