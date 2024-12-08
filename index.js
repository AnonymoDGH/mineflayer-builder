const { goals, Movements } = require('../mineflayer-pathfinder');
const interactable = require('./lib/interactable.json');

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function inject(bot, options = {}) {
  if (!bot.pathfinder) {
    throw new Error('pathfinder must be loaded before builder');
  }

  const mcData = require('minecraft-data')(bot.version);
  const Item = require('prismarine-item')(bot.version);

  const defaultOptions = {
    buildSpeed: 1.0, // 1.0 is normal speed, 0.5 is half speed, etc.
    useTools: true,
    onError: 'pause', // 'pause', 'cancel', or 'continue'
    bots: [bot] // Array of bots to collaborate
  };

  const settings = { ...defaultOptions, ...options };

  const movements = new Movements(bot, {
    maxDropDown: 256,
    maxClimbUp: 256
  });

  bot.pathfinder.setMovements(movements);
  bot.pathfinder.searchRadius = 10;

  bot.builder = {};

  async function equipItem(id) {
    if (bot.inventory.items().length > 30) {
      bot.chat('/clear');
      await wait(1000);
    }
    if (!bot.inventory.items().find(x => x.type === id)) {
      const slot = bot.inventory.items().findIndex(x => x.type === 0);
      if (slot !== -1) {
        await bot.creative.setInventorySlot(slot, new Item(id, 1));
      }
    }
    const item = bot.inventory.items().find(x => x.type === id);
    await bot.equip(item, 'hand');
  }

  bot.builder.equipItem = equipItem;

  let currentBuild = null;

  bot.builder.build = async (build) => {
    currentBuild = build;

    try {
      while (build.actions.length > 0) {
        if (build.isCancelled) {
          bot.emit('builder_cancelled');
          break;
        }

        if (build.isPaused) {
          await wait(1000);
          continue;
        }

        const availableActions = build.getAvailableActions();
        if (availableActions.length === 0) {
          console.log('No actions to perform');
          break;
        }

        // Distribute actions among bots
        const bots = settings.bots.filter(b => b.pathfinder && b.pathfinder.movements);
        for (const bot of bots) {
          if (build.actions.length === 0) break;

          const action = build.actions[0];
          try {
            if (action.type === 'place') {
              const item = build.getItemForState(action.state);
              const properties = build.properties[action.state];
              const half = properties.half ? properties.half : properties.type;

              const faces = build.getPossibleDirections(action.state, action.pos);
              for (const face of faces) {
                const block = bot.blockAt(action.pos.plus(face));
              }

              const { facing, is3D } = build.getFacing(action.state, properties.facing);
              const goal = new goals.GoalPlaceBlock(action.pos, bot.world, {
                faces,
                facing: facing,
                facing3D: is3D,
                half
              });

              if (!goal.isEnd(bot.entity.position.floored())) {
                bot.pathfinder.setMovements(movements);
                await bot.pathfinder.goto(goal);
              }

              await equipItem(item.id);

              const faceAndRef = goal.getFaceAndRef(bot.entity.position.floored().offset(0.5, 1.6, 0.5));
              if (!faceAndRef) { throw new Error('no face and ref'); }

              bot.lookAt(faceAndRef.to, true);

              const refBlock = bot.blockAt(faceAndRef.ref);
              const sneak = interactable.indexOf(refBlock.name) > 0;
              if (sneak) bot.setControlState('sneak', true);
              await bot._placeBlockWithOptions(refBlock, faceAndRef.face.scaled(-1), { half, delta: faceAndRef.to.minus(faceAndRef.ref) });
              if (sneak) bot.setControlState('sneak', false);

              const block = bot.world.getBlock(action.pos);
              if (block.stateId !== action.state) {
                console.log('Block placement failed');
              }
            } else if (action.type === 'dig') {
              const block = bot.blockAt(action.pos);
              await bot.dig(block);
            }

            build.markActionComplete(action);
            build.removeAction(action);
            bot.emit('builder_progress', build.getProgress());
            await wait(1000 / settings.buildSpeed);
          } catch (e) {
            console.log(e);
            bot.emit('builder_error', e);
            if (settings.onError === 'pause') {
              build.pause();
              bot.emit('builder_paused');
              break;
            } else if (settings.onError === 'cancel') {
              build.cancel();
              bot.emit('builder_cancelled');
              break;
            }
          }
        }
      }

      if (!build.isCancelled) {
        bot.emit('builder_finished');
      }
    } catch (e) {
      bot.emit('builder_error', e);
    } finally {
      currentBuild = null;
    }
  };

  // Control functions
  bot.builder.pause = () => {
    if (currentBuild) {
      currentBuild.pause();
      bot.emit('builder_paused');
    }
  };

  bot.builder.resume = () => {
    if (currentBuild) {
      currentBuild.resume();
      bot.emit('builder_resumed');
    }
  };

  bot.builder.cancel = () => {
    if (currentBuild) {
      currentBuild.cancel();
    }
  };

  bot.builder.getProgress = () => {
    if (currentBuild) {
      return currentBuild.getProgress();
    }
    return null;
  };
}

module.exports = {
  Build: require('./lib/build.js'),
  builder: inject
};
