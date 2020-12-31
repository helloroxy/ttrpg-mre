import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { EventEmitter } from 'events';

import { Die, DieType } from './die';
import { DiceGroup } from './diceGroup';
import App from './app';
import { textHeightForWidth } from './utils';

export class RollView extends EventEmitter {
	private _root: MRE.Actor;
	public get root() { return this._root; }

	public rollDisplay: Die[] = [];
	private rollButton: MRE.Actor;
	private rollResults: MRE.Actor;

	private _labelText = "ROLL";
	public get labelText() {
		return this.rollButton ? this.rollButton.text.contents : this._labelText;
	}
	public set labelText(value) {
		if (this.rollButton) {
			this.rollButton.text.contents = value;
			this.rollButton.text.height = textHeightForWidth(value, 0.3, 0.05)
		} else {
			this._labelText = value;
		}
	}

	private _labelTextColor = MRE.Color3.White();
	public get labelTextColor() { return this._labelTextColor; }
	public set labelTextColor(value) {
		this._labelTextColor = value;
		if (this.rollButton) {
			this.rollButton.text.color = this._labelTextColor;
		}
		if (this.rollResults) {
			this.rollResults.text.color = this._labelTextColor;
		}
	}

	public constructor(private app: App, private activeRoll: DiceGroup[], actorProps?: Partial<MRE.ActorLike>) {
		super();

		this._root = MRE.Actor.Create(this.app.context, { actor: {
			name: "RollDisplayRoot",
			...actorProps
		}});

		this.refresh();
	}

	public refresh() {
		if (!this.rollButton) {
			this.rollButton = MRE.Actor.Create(this.app.context, { actor: {
				name: "RollButton",
				parentId: this.root.id,
				text: {
					enabled: this.activeRoll.length > 0,
					contents: this._labelText,
					color: this._labelTextColor,
					height: textHeightForWidth(this._labelText, 0.3, 0.05),
					anchor: MRE.TextAnchorLocation.MiddleCenter,
					justify: MRE.TextJustify.Right
				},
				collider: {
					geometry: { shape: MRE.ColliderType.Box, size: { x: 0.2, y: 0.1, z: 0.01 }}
				}
			}});
			this.rollButton.setBehavior(MRE.ButtonBehavior).onButton('pressed', user => this.emit('labelPressed', user));
		} else {
			this.rollButton.text.enabled = this.activeRoll.length > 0;
		}

		const rollTotal = this.activeRoll.reduce((sum, dg) => sum + (dg.hasRollResults ? dg.total : 0), 0);
		if (!this.rollResults) {
			this.rollResults = MRE.Actor.Create(this.app.context, { actor: {
				name: "RollResults",
				parentId: this.root.id,
				text: {
					enabled: this.activeRoll.length > 0,
					contents: rollTotal > 0 ? `= ${rollTotal}` : "= ??",
					color: this._labelTextColor,
					height: 0.05,
					anchor: MRE.TextAnchorLocation.MiddleCenter,
					justify: MRE.TextJustify.Center
				}
			}});
		} else {
			this.rollResults.text.enabled = this.activeRoll.length > 0;
			this.rollResults.text.contents = '= ' + (rollTotal > 0 ? rollTotal : "??");
		}

		const oldDice = this.rollDisplay;
		this.rollDisplay = [];

		const layout = new MRE.PlanarGridLayout(this.root,
			MRE.BoxAlignment.MiddleCenter, MRE.BoxAlignment.MiddleCenter);
		layout.addCell({ row: 0, column: 0, width: 0.2, height: 0.1, contents: this.rollButton });

		let nextColumn = 1;

		this.activeRoll.sort(sortDiceGroups);
		for (const dg of this.activeRoll) {
			for (let i = 0; i < dg.count; i++) {
				const reusedDieIndex = oldDice.findIndex(d => d.type === dg.type);
				let d: Die;

				// reuse old die
				if (reusedDieIndex >= 0) {
					d = oldDice.splice(reusedDieIndex, 1)[0];
				// add a new die (unless constant)
				} else if (dg.type !== DieType.D1 || i === 0){
					d = new Die({
						app: this.app, type: dg.type, text: dg.type,
						actor: { parentId: this.root.id }
					});
					const di = i;
					// remove die, or reset the roll on click
					d.on('click', user => this.emit('diePressed', user, di));
				} else {
					break;
				}

				if (dg.type === DieType.D1) {
					d.text = '+' + dg.count;
				} else if (dg.hasRollResults) {
					d.text = dg.results[i].toString();
					d.textColor = dg.contributingResults.includes(i) ? MRE.Color3.White() : MRE.Color3.Gray();
				} else {
					d.textColor = MRE.Color3.White();
				}

				this.rollDisplay.push(d);
				layout.addCell({ row: 0, column: nextColumn++, width: 0.1, height: 0.1, contents: d.root });
			}
		}

		layout.addCell({ row: 0, column: nextColumn++, width: 0.12, height: 0.1, contents: this.rollResults });

		Promise.all(this.rollDisplay.map(d => d.root.created())).then(() => {
			layout.applyLayout();
			this.emit('refreshed');
		}).catch(err => MRE.log.error('app', err));

		for (const d of oldDice) {
			d.destroy();
		}
	}

	public destroy() {
		for (const d of this.rollDisplay) {
			d.destroy();
		}
		this.root.destroy();
	}

	public on(event: 'labelPressed', listener: MRE.ActionHandler): this;
	public on(event: 'diePressed', listener: MRE.ActionHandler<number>): this;
	public on(event: 'refreshed', listener: () => void): this;
	public on(event: 'labelPressed' | 'diePressed' | 'refreshed', listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	public off(event: 'labelPressed', listener: MRE.ActionHandler): this;
	public off(event: 'diePressed', listener: MRE.ActionHandler<number>): this;
	public off(event: 'refreshed', listener: () => void): this;
	public off(event: 'labelPressed' | 'diePressed' | 'refreshed', listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}
}

function sortDiceGroups(a: DiceGroup, b: DiceGroup) {
	const rankings = Object.values(DieType);
	const aRank = rankings.indexOf(a.type), bRank = rankings.indexOf(b.type);
	if (aRank < bRank) {
		return -1;
	} else if (aRank > bRank) {
		return 1;
	} else {
		return 0;
	}
}
