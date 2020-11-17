let { push, pop } = require('heapq');

export default class BinaryHeap {
    constructor() {
        this.heap = [];
        this.cmp = function(x, y) { return x[1] < y[1]; }
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    parent(i) {
        return (i - 1) / 2;
    }

    insert(v, d) {
        push(this.heap, [v, d], this.cmp);
    }

    decreasePriority(i, newVal) {
        this.heap[i] = newVal;
        while (i !== 0 && this.heap[this.parent(i)] > this.heap[i]) {
            let temp = this.heap[i];
            this.heap[i] = this.heap[this.parent(i)];
            this.heap[this.parent(i)] = temp;
        }
    }

    extractMin() {
        return pop(this.heap, this.cmp);
    }
    
}