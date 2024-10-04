import { Injectable } from '@angular/core';
import { Subject, Subscription } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class EventsService {
    private events = new Map();;

    constructor() {
        // ---
    }
    public subscribe(event: string, callback: (value: any) => void): Subscription {
        if(this.events.has(event) === false) {
            this.events.set(event, new Subject<any>());
        }
        return this.events.get(event).asObservable().subscribe(callback);
    }
    public publish(event: string, eventObject?: any): void {
        if(this.events.has(event) === true) {
            this.events.get(event).next(eventObject);
        }
    }
}
