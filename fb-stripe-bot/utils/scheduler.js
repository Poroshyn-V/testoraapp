// Scheduler Utility
import { mainUpdate } from '../main.js';

export class Scheduler {
  constructor() {
    this.tasks = new Map();
    this.intervals = new Map();
  }

  // Start the scheduler
  start() {
    console.log('⏰ Scheduler started');
    this.scheduleDefaultTasks();
  }

  // Schedule default tasks
  scheduleDefaultTasks() {
    // Sync data every 15 minutes
    this.schedule('main-update', mainUpdate, 15 * 60 * 1000);
    
    console.log('✅ Default tasks scheduled');
  }

  // Schedule a task
  schedule(name, task, interval) {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
    }
    
    const intervalId = setInterval(async () => {
      try {
        console.log(`🔄 Running task: ${name}`);
        await task();
        console.log(`✅ Task completed: ${name}`);
      } catch (error) {
        console.error(`❌ Task failed: ${name}`, error);
      }
    }, interval);
    
    this.intervals.set(name, intervalId);
    console.log(`📅 Scheduled task: ${name} (every ${interval / 1000}s)`);
  }

  // Stop a specific task
  stop(name) {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
      this.intervals.delete(name);
      console.log(`⏹️ Stopped task: ${name}`);
    }
  }

  // Stop all tasks
  stopAll() {
    for (const [name, intervalId] of this.intervals) {
      clearInterval(intervalId);
      console.log(`⏹️ Stopped task: ${name}`);
    }
    this.intervals.clear();
  }

  // Get task status
  getStatus() {
    return {
      activeTasks: Array.from(this.intervals.keys()),
      taskCount: this.intervals.size
    };
  }
}

// Standalone scheduler function
export function startScheduler() {
  console.log("⏰ Scheduler started: updating every 15 minutes");
  mainUpdate();
  setInterval(mainUpdate, 15 * 60 * 1000);
}
