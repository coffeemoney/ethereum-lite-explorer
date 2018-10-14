import Vue from 'vue';
import Buefy from 'buefy';
import uuidv1 from 'uuid/v1';
import VTooltip from 'v-tooltip';

import App from './App.vue';
import router from './router';
import store from './store';

Vue.config.productionTip = false;

// Buefy is a collection of BulmaCSS components for VueJS: https://buefy.github.io/#/documentation/start
Vue.use(Buefy);

// VTooltip helps us display tooltips easily: https://github.com/Akryum/v-tooltip
Vue.use(VTooltip);

/*
 * We define here global functions that are accessible by any instance of Vue
 * This is the core utils of the project
 */
Vue.mixin({
  methods: {
    /*
     * Navigate to a block information page
     */
    lib_goToBlock(blockNumber) {
      this.$router.push({
        path: `/block/${blockNumber}`,
      });
    },
    /*
     * Navigate to an account information page
     */
    lib_goToAccount(address) {
      this.$router.push({
        path: `/account/${address}`,
      });
    },
    /*
     * Navigate to tx information page
     */
    lib_goToTx(hash) {
      this.$router.push({
        path: `/tx/${hash}`,
      });
    },
    /*
     ** Get a block either from RPC, cache.
     */
    lib_getBlock(blockNumber, callback) {
      if (blockNumber < 0) {
        callback(null, null);
      } else if (this.$store.state.blocks[blockNumber] == null) {
        this.$store.commit('setPending', blockNumber);
        var context = this;
        this.$store.state.w3.eth.getBlock(`${blockNumber}`, true, (err, block) => {
          if (block != null) {
            context.$store.commit('setLastBlock', block.number);
            for (let i = 0; i < block.transactions.length; i++) {
              context.$store.commit('storeTransaction', context.lib_processTX(block.transactions[i]));
              block.transactions[i] = block.transactions[i].hash;
            }
            context.$store.commit('storeBlock', block);
          }
          context.$store.commit('removePending', blockNumber);
          callback(null, block);
        });
      } else if (this.$store.state.pendingQueries[blockNumber]) {
        setTimeout(() => {
          context.lib_getBlock(blockNumber, callback);
        }, 500);
      } else {
        // console.log('We already have the block');
        callback(null, this.$store.state.blocks[blockNumber]);
      }
    },
    /*
     ** Get a transaction either from RPC, cache.
     */
    lib_getTransaction(transactionHash, withreceipt, callback) {
      withreceipt = withreceipt || false;
      const context = this;
      //  console.log('Get transaction', transactionHash, withreceipt)
      if (context.$store.state.transactions[transactionHash] == null) {
        context.$store.commit('setPending', transactionHash);
        context.$store.state.w3.eth.getTransaction(transactionHash, (err, tx) => {
          if (err || tx == null) {
            callback(true, null);
            context.$store.commit('removePending', transactionHash);
          } else if (withreceipt) {
            context.$store.state.w3.eth.getTransactionReceipt(transactionHash, (err, receipt) => {
              tx.receipt = receipt;
              context.$store.commit('storeTransaction', context.lib_processTX(tx));
              context.$store.commit('removePending', transactionHash);
              callback(null, tx);
            });
          } else {
            context.$store.commit('storeTransaction', context.lib_processTX(tx));
            context.$store.commit('removePending', transactionHash);
            callback(null, tx);
          }
        });
      } else if (!this.$store.state.pendingQueries[transactionHash]) {
        // console.log('We already have the tx');
        const tx = this.$store.state.transactions[transactionHash];
        if (tx.receipt == null && withreceipt) {
          this.$store.commit('setPending', transactionHash);
          this.$store.state.w3.eth.getTransactionReceipt(transactionHash, (err, receipt) => {
            tx.receipt = receipt;
            context.$store.commit('storeTransaction', context.lib_processTX(tx));
            context.$store.commit('removePending', transactionHash);
            callback(null, tx);
          });
        } else {
          callback(null, tx);
        }
      } else {
        setTimeout(() => {
          context.lib_getTransaction(transactionHash, withreceipt, callback);
        }, 500);
      }
    },
    /*
     **
     */
    lib_getAccount(address, callback) {
      const context = this;
      this.$store.state.w3.eth.getBalance(address, (err, balance) => {
        if (err) {
          callback(err, null);
        } else {
          context.$store.state.w3.eth.getCode(address, (err, code) => {
            if (err) {
              callback(err, null);
            } else {
              callback(null, {
                balance,
                balance_eth: parseFloat(context.$store.state.w3.utils.fromWei(balance)),
                code,
                isContract: (code != '0x'),
              });
            }
          });
        }
      });
    },
    /*
     ** Internal function to enrich/decode any field of a transaction so render don't have to.
     */
    lib_processTX(transaction) {
      transaction.value_eth = parseFloat(this.$store.state.w3.utils.fromWei(transaction.value));
      if (transaction.receipt != null) {
        transaction.gas_used_percent = transaction.receipt.gasUsed / transaction.gas * 100;
      }
      return (transaction);
    },
    /*
     ** Return a uique ID that is convenient for preventing callbacks to write after the state has changed
     */
    lib_UID() {
      return (uuidv1());
    },
    lib_monitorLastBlock() {
      const context = this;
      this.$store.state.w3.eth.getBlock('latest', (err, block) => {
        // console.log("We get latest block", err, block)
        if (!err && block != null) {
          context.$store.commit('setLastBlock', block.number);
        }
      });
      setTimeout(this.lib_monitorLastBlock, 4000);
    },
    lib_guessInputType(input) {
      if (input == null) {
        return ({'type': 'none', 'value': input})
      }
      input = input.replace(/[^A-Z0-9]+/ig, "");
      input = input.toLowerCase();
      if ('' + parseInt(input) == input && !input.startsWith('0x')) {
        return ({'type': 'block', 'value': parseInt(input)})
      } else {
        if (!input.startsWith('0x')) {
          input = '0x' + input;
        }
        if (this.$store.state.w3.utils.isHexStrict(input)) {
          if (input.length == 42) {
            return ({'type': 'account', 'value': input})
          } else if (input.length == 66) {
            return ({'type': 'tx', 'value': input})
          } else {
            return ({'type': 'none', 'value': input})
          }
        }

      }
      return ({'type': 'none', 'value': input})
    },
    lib_processSearch(input) {
      var inputType = this.lib_guessInputType(input);
      if (inputType.type == 'tx') {
        this.lib_goToTx(inputType.value)
      } else if (inputType.type == 'block') {
        this.lib_goToBlock(inputType.value)
      } else if (inputType.type == 'account') {
        this.lib_goToAccount(inputType.value)
      } else {
        this.$router.push({
          path: `/404`,
        });
      }
    },
    lib_openSearch() {
      this.$dialog.prompt({
        message: `Enter a blocknumber, transaction hash or address.`,
        inputAttrs: {
          placeholder: 'e.g. 0x45434...',
          maxlength: 100
        },
        onConfirm: (value) => this.lib_processSearch(value)
      })
    }
  },
});

new Vue({
  router,
  store,
  render: h => h(App),
}).$mount('#app');
