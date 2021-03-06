import * as React from 'react';
import ReactTable from "react-table";
import {Footer, Tips} from '../Utils';
import {Logger} from '../../../../web/js/logger/Logger';
import {DocLoader} from '../../../../web/js/apps/main/ipc/DocLoader';
import {Strings} from '../../../../web/js/util/Strings';
import {RepoDocInfoLoader} from '../RepoDocInfoLoader';
import {AppState} from '../AppState';
import {RepoDocInfo} from '../RepoDocInfo';
import {RepoDocInfos} from '../RepoDocInfos';
import {RepoDocInfoManager} from '../RepoDocInfoManager';
import {TagInput} from '../TagInput';
import {Optional} from '../../../../web/js/util/ts/Optional';
import {Tag} from '../../../../web/js/tags/Tag';
import {FilterTagInput} from '../FilterTagInput';
import {FilteredTags} from '../FilteredTags';
import {isPresent} from '../../../../web/js/Preconditions';
import {Sets} from '../../../../web/js/util/Sets';
import {Tags} from '../../../../web/js/tags/Tags';
import {DateTimeTableCell} from '../DateTimeTableCell';
import {RendererAnalytics} from '../../../../web/js/ga/RendererAnalytics';
import {MessageBanner} from '../MessageBanner';
import {DocDropdown} from '../DocDropdown';
import {TableDropdown} from '../TableDropdown';
import {TableColumns} from '../TableColumns';
import {SettingsStore} from '../../../../web/js/datastore/SettingsStore';
import {Version} from '../../../../web/js/util/Version';
import {RepoDocInfoIndex} from '../RepoDocInfoIndex';
import {AutoUpdatesController} from '../../../../web/js/auto_updates/AutoUpdatesController';
import {IDocInfo} from '../../../../web/js/metadata/DocInfo';
import {SyncBarProgress} from '../../../../web/js/ui/sync_bar/SyncBar';
import {IEventDispatcher, SimpleReactor} from '../../../../web/js/reactor/SimpleReactor';
import {DocRepoAnkiSyncController} from '../../../../web/js/controller/DocRepoAnkiSyncController';
import {CloudAuthButton} from '../../../../web/js/ui/cloud_auth/CloudAuthButton';
import {PersistenceLayerManager, PersistenceLayerTypes} from '../../../../web/js/datastore/PersistenceLayerManager';
import {PersistenceLayerEvent} from '../../../../web/js/datastore/PersistenceLayerEvent';
import {CloudService} from '../cloud/CloudService';
import {Throttler} from '../../../../web/js/datastore/Throttler';
import {PersistenceLayer} from '../../../../web/js/datastore/PersistenceLayer';
import {Backend} from '../../../../web/js/datastore/Backend';
import {Hashcode} from '../../../../web/js/metadata/Hashcode';
import {FileRef} from '../../../../web/js/datastore/Datastore';
import {ListenablePersistenceLayer} from '../../../../web/js/datastore/ListenablePersistenceLayer';

const log = Logger.create();

export default class DocRepoTable extends React.Component<IProps, IState> {

    private readonly persistenceLayerManager: PersistenceLayerManager;

    private readonly filteredTags = new FilteredTags();

    private readonly syncBarProgress: IEventDispatcher<SyncBarProgress> = new SimpleReactor();

    constructor(props: IProps, context: any) {
        super(props, context);

        this.persistenceLayerManager = this.props.persistenceLayerManager;

        this.onDocTagged = this.onDocTagged.bind(this);
        this.onDocDeleted = this.onDocDeleted.bind(this);
        this.onDocSetTitle = this.onDocSetTitle.bind(this);
        this.onSelectedColumns = this.onSelectedColumns.bind(this);
        this.onFilterByTitle = this.onFilterByTitle.bind(this);

        this.state = {
            data: [],
            columns: new TableColumns()
        };

        this.init();

        this.initAsync()
            .catch(err => log.error("Could not init: ", err));

    }


    private init() {

        const persistenceLayerListener = (persistenceLayerEvent: PersistenceLayerEvent) => {
            this.onUpdatedDocInfo(persistenceLayerEvent.docInfo);
        };

        const onPersistenceLayer = (persistenceLayer?: ListenablePersistenceLayer) => {

            if (persistenceLayer) {
                persistenceLayer.addEventListener(persistenceLayerListener);
            }

        };

        onPersistenceLayer(this.persistenceLayerManager.get());

        this.persistenceLayerManager.addEventListener(event => {

            if (event.state === 'changed') {
                onPersistenceLayer(event.persistenceLayer);
            }

        });

        // TODO/FIXME: most of this code needs to be removed before react-router
        // is in use so it's not screen dependent.

        // don't refresh too often if we get lots of documents as this really
        // locks up the UI but we also need a reasonable timeout.
        //
        // TODO: this is a tough decision as it trades throughput for latency
        // and I don't want latency in the UI.  It might be better to batch into
        // 50 items each when SENDING the events and not throttling the events
        // but throttling the actual snapshot rate.  For example, if we receive
        // a snapshot with 500 items we can just break that into say 50 items
        // each and then immediately update the UI with no trailing latency at
        // the end.  But we can throttle the actual number of snapshots so that
        // if we receive tons of snapshots with 1 item them we batch these but
        // even THEN that would add latency because we're not sure how often
        // the server is sending data.

        const refreshThrottler = new Throttler(() => {
            this.refresh();
        }, {maxRequests: 100, maxTimeout: 300});

        let hasSentInitAnalyitics = false;

        this.props.repoDocInfoLoader.addEventListener(event => {

            refreshThrottler.exec();

            if (! hasSentInitAnalyitics && event.progress.progress === 100) {
                this.emitInitAnalytics(this.props.repoDocInfoManager.repoDocs);
                hasSentInitAnalyitics = true;
            }

        });

    }

    private async initAsync(): Promise<void> {

        const settings = await SettingsStore.load();

        log.info("Settings loaded: ", settings);

        Optional.of(settings.documentRepository)
            .map(current => current.columns)
            .when(columns => {

                log.info("Loaded columns from settings: ", columns);
                this.setState(Object.assign(this.state, {columns}));
                this.refresh();

            });

        this.refresh();

    }

    private emitInitAnalytics(repoDocs: RepoDocInfoIndex) {

        RendererAnalytics.pageview("/");

        const nrDocs = Object.keys(repoDocs).length;

        RendererAnalytics.set({'nrDocs': nrDocs});

        const persistenceLayerType = this.persistenceLayerManager.currentType();

        RendererAnalytics.event({category: 'document-repository', action: `docs-loaded-${persistenceLayerType}-${nrDocs}`});

        RendererAnalytics.event({category: 'app', action: 'version-' + Version.get()});

    }

    public refresh() {
        this.refreshState(this.filterRepoDocInfos(Object.values(this.props.repoDocInfoManager!.repoDocs)));
    }

    public highlightRow(selected: number) {

        const state: AppState = Object.assign({}, this.state);
        state.selected = selected;

        this.setState(state);

    }

    public render() {
        const { data } = this.state;
        return (

            <div id="doc-repo-table">

                <header>

                    <div id="header-logo">
                        <img src="./img/icon.svg" height="25"/>
                    </div>

                    <div id="header-title">
                        <h1>POLAR</h1>
                    </div>

                    <div id="header-filter">

                        <div className="header-filter-boxes">

                            <div className="header-filter-box"
                                 style={{whiteSpace: 'nowrap'}}>
                                <div className="checkbox-group">
                                    <input id="filter_flagged"
                                           type="checkbox"
                                           className="header-filter-clickable"
                                           onChange={() => this.refresh()}/>
                                    <label className="header-filter-clickable"
                                           htmlFor="filter_flagged">flagged only</label>
                                </div>
                            </div>

                            <div className="header-filter-box"
                                 style={{whiteSpace: 'nowrap'}}>
                                <div className="checkbox-group">

                                    <input id="filter_archived"
                                           defaultChecked
                                           type="checkbox"
                                           className="header-filter-clickable"
                                           onChange={() => this.refresh()}/>

                                    <label className="header-filter-clickable"
                                           htmlFor="filter_archived">hide archived</label>

                                </div>

                            </div>

                            <div className="header-filter-box header-filter-tags"
                                 style={{whiteSpace: 'nowrap'}}>

                                <FilterTagInput tagsDBProvider={() => this.props.repoDocInfoManager!.tagsDB}
                                                refresher={() => this.refresh()}
                                                filteredTags={this.filteredTags} />

                            </div>

                            <div className="header-filter-box">
                                <input id="filter_title"
                                       type="text"
                                       placeholder="Filter by title"
                                       onChange={() => this.onFilterByTitle()}/>
                            </div>

                            <div className="header-filter-box">
                                <CloudAuthButton persistenceLayerManager={this.persistenceLayerManager} />
                            </div>

                            <div className="p-1">

                                <TableDropdown id="table-dropdown"
                                               options={Object.values(this.state.columns)}
                                               onSelectedColumns={() => this.onSelectedColumns()}/>
                            </div>

                        </div>


                    </div>


                </header>

                <MessageBanner/>

                <div id="doc-table">
                <ReactTable
                    data={data}
                    columns={
                        [
                            {
                                Header: 'Title',
                                accessor: 'title',
                                Cell: (row: any) => {
                                    const id = 'doc-repo-row-title' + row.index;
                                    return (
                                        <div id={id}>

                                            <div>{row.value}</div>

                                            {/*TODO: this doesn't reliably work as*/}
                                            {/*moving the mouse horizontally within*/}
                                            {/*the target doesn't close the tooltip.*/}

                                                {/*<UncontrolledTooltip style={{maxWidth: '1000px'}}*/}
                                                                     {/*placement="bottom"*/}
                                                                     {/*delay={{show: 750, hide: 0}}*/}
                                                                     {/*target={id}>*/}
                                                    {/*<Collapse timeout={{ enter: 0, exit: 0 }} >*/}
                                                        {/*{row.value}*/}
                                                    {/*</Collapse>*/}

                                                {/*</UncontrolledTooltip>*/}

                                        </div>

                                    );
                                }

                            },
                            {
                                Header: 'Updated',
                                // accessor: (row: any) => row.added,
                                accessor: 'lastUpdated',
                                show: this.state.columns.lastUpdated.selected,
                                maxWidth: 100,
                                defaultSortDesc: true,
                                Cell: (row: any) => (
                                    <DateTimeTableCell className="doc-col-last-updated" datetime={row.value}/>
                                )

                            },
                            {
                                Header: 'Added',
                                // accessor: (row: any) => row.added,
                                accessor: 'added',
                                show: this.state.columns.added.selected,
                                maxWidth: 100,
                                defaultSortDesc: true,
                                Cell: (row: any) => (
                                    <DateTimeTableCell className="doc-col-added" datetime={row.value}/>
                                )
                            },
                            //
                            // d => {
                            //     return Moment(d.updated_at)
                            //         .local()
                            //         .format("DD-MM-YYYY hh:mm:ss a")
                            // }

                            // {
                            //     Header: 'Last Name',
                            //     id: 'lastName',
                            //     accessor: (d: any) => d.lastName
                            // },
                            {
                                id: 'tags',
                                Header: 'Tags',
                                accessor: '',
                                show: this.state.columns.tags.selected,
                                Cell: (row: any) => {

                                    const tags: {[id: string]: Tag} = row.original.tags;

                                    const formatted = Object.values(tags)
                                        .map(tag => tag.label)
                                        .sort()
                                        .join(", ");

                                    return (
                                        <div>{formatted}</div>
                                    );

                                }
                            },
                            {
                                id: 'nrAnnotations',
                                Header: 'Annotations',
                                accessor: 'nrAnnotations',
                                maxWidth: 110,
                                show: this.state.columns.nrAnnotations.selected,
                                defaultSortDesc: true,
                                resizable: false,
                            },
                            {
                                id: 'progress',
                                Header: 'Progress',
                                accessor: 'progress',
                                show: this.state.columns.progress.selected,
                                maxWidth: 100,
                                defaultSortDesc: true,
                                resizable: false,
                                Cell: (row: any) => (

                                    <progress max="100" value={ row.value } style={{
                                        width: '100%'
                                    }} />
                                )
                            },
                            {
                                id: 'tag-input',
                                Header: '',
                                accessor: '',
                                maxWidth: 25,
                                defaultSortDesc: true,
                                resizable: false,
                                Cell: (row: any) => {

                                    const repoDocInfo: RepoDocInfo = row.original;

                                    const existingTags: Tag[]
                                        = Object.values(Optional.of(repoDocInfo.docInfo.tags).getOrElse({}));

                                    return (
                                        <TagInput repoDocInfo={repoDocInfo}
                                                  tagsDB={this.props.repoDocInfoManager!.tagsDB}
                                                  existingTags={existingTags}
                                                  onChange={(_, tags) =>
                                                      this.onDocTagged(repoDocInfo, tags)
                                                          .catch(err => log.error("Unable to update tags: ", err))} />
                                    );

                                }
                            },
                            {
                                id: 'flagged',
                                Header: '',
                                accessor: 'flagged',
                                show: this.state.columns.flagged.selected,
                                maxWidth: 25,
                                defaultSortDesc: true,
                                resizable: false,
                                Cell: (row: any) => {

                                    const title = 'Flag document';

                                    if (row.original.flagged) {
                                        return (
                                            <i className="fa fa-flag doc-button doc-button-active" title={title}/>
                                        );
                                    } else {
                                        return (
                                            <i className="fa fa-flag doc-button doc-button-inactive" title={title}/>
                                        );
                                    }

                                }
                            },
                            {
                                id: 'archived',
                                Header: '',
                                accessor: 'archived',
                                show: this.state.columns.archived.selected,
                                maxWidth: 25,
                                defaultSortDesc: true,
                                resizable: false,
                                Cell: (row: any) => {

                                    const title = 'Archive document';

                                    const uiClassName = row.original.archived ? 'doc-button-active' : 'doc-button-inactive';

                                    const className = `fa fa-check doc-button ${uiClassName}`;

                                    return (
                                        <i className={className} title={title}/>
                                    );

                                }
                            },
                            {
                                id: 'doc-dropdown',
                                Header: '',
                                accessor: '',
                                maxWidth: 25,
                                defaultSortDesc: true,
                                resizable: false,
                                sortable: false,
                                className: 'doc-dropdown',
                                Cell: (row: any) => {

                                    const repoDocInfo: RepoDocInfo = row.original;

                                    return (
                                        <DocDropdown id={'doc-dropdown-' + row.index}
                                                     repoDocInfo={repoDocInfo}
                                                     onDelete={this.onDocDeleted}
                                                     onSetTitle={this.onDocSetTitle}/>
                                    );

                                }
                            }




                        ]}

                    defaultPageSize={25}
                    noDataText="No documents available."
                    className="-striped -highlight"
                    defaultSorted={[
                        {
                            id: "progress",
                            desc: true
                        }
                    ]}
                    // sorted={[{
                    //     id: 'added',
                    //     desc: true
                    // }]}
                    getTrProps={(state: any, rowInfo: any) => {
                        return {

                            onClick: (e: any) => {
                                // console.log(`doc fingerprint: ${rowInfo.original.fingerprint} and filename ${rowInfo.original.filename}`);
                                this.highlightRow(rowInfo.index as number);
                            },

                            style: {
                                background: rowInfo && rowInfo.index === this.state.selected ? '#00afec' : 'white',
                                color: rowInfo && rowInfo.index === this.state.selected ? 'white' : 'black',
                            }
                        };
                    }}
                    getTdProps={(state: any, rowInfo: any, column: any, instance: any) => {

                        const singleClickColumns = ['tag-input', 'flagged', 'archived', 'doc-dropdown'];

                        if (! singleClickColumns.includes(column.id)) {
                            return {
                                onDoubleClick: (e: any) => {
                                    this.onDocumentLoadRequested(rowInfo.original.fingerprint,
                                                                 rowInfo.original.filename,
                                                                 rowInfo.original.hashcode);
                                }
                            };
                        }

                        if (singleClickColumns.includes(column.id)) {

                            return {

                                onClick: ((e: any, handleOriginal?: () => void) => {

                                    this.handleToggleField(rowInfo.original, column.id)
                                        .catch(err => log.error("Could not handle toggle: ", err));

                                    if (handleOriginal) {
                                        // needed for react table to function
                                        // properly.
                                        handleOriginal();
                                    }

                                })

                            };

                        }

                        return {};

                    }}

                />
                <br />
                <Tips />
                <Footer/>

                </div>

                {/*<CookieBanner*/}
                    {/*message="We use cookies to track user behavior using Google Analytics and other 3rd party services. "*/}
                    {/*buttonMessage="I Accept"*/}
                    {/*link={<a href='https://github.com/burtonator/polar-bookshelf/blob/master/docs/Tracking-Policy.md'>
                                More information</a>}*/}
                    {/*styles={{*/}
                        {/*banner: { backgroundColor: 'rgba(60, 60, 60, 0.8)', position: 'fixed', left: '0', bottom: '0' },*/}
                        {/*message: { fontWeight: 400 }*/}
                    {/*}}*/}
                    {/*dismissOnClick={true}*/}
                    {/*onAccept={() => console.log('accepted')}*/}
                    {/*cookie="user-has-accepted-cookies"*/}
                    {/*//*/}
                {/*/>*/}

            </div>

        );
    }

    private async onDocTagged(repoDocInfo: RepoDocInfo, tags: Tag[]) {

        RendererAnalytics.event({category: 'user', action: 'doc-tagged'});

        await this.props.repoDocInfoManager!.writeDocInfoTags(repoDocInfo, tags);
        this.refresh();

    }

    private onDocDeleted(repoDocInfo: RepoDocInfo) {

        RendererAnalytics.event({category: 'user', action: 'doc-deleted'});

        log.info("Deleting document: ", repoDocInfo);

        this.props.repoDocInfoManager.deleteDocInfo(repoDocInfo)
            .catch(err => log.error("Could not delete doc: ", err));

        this.refresh();

    }

    private onDocSetTitle(repoDocInfo: RepoDocInfo, title: string) {

        RendererAnalytics.event({category: 'user', action: 'set-doc-title'});

        log.info("Setting doc title: " , title);

        this.props.repoDocInfoManager.writeDocInfoTitle(repoDocInfo, title)
            .catch(err => log.error("Could not write doc title: ", err));

        this.refresh();

    }

    private onSelectedColumns() {

        RendererAnalytics.event({category: 'user', action: 'selected-columns'});

        // new columns have been selected. Note that the UI updates the values
        // directly so we can just write what's in memory to disk. I think it
        // would be better practice to keep them immutable.

        SettingsStore.load()
            .then((settings) => {
                settings.documentRepository.columns = this.state.columns;
                SettingsStore.write(settings);
            })
            .catch(err => log.error("Could not load settings: ", err));

        this.refresh();
    }


    private onFilterByTitle() {

        RendererAnalytics.event({category: 'user', action: 'filter-by-title'});

        this.refresh();

    }

    private refreshState(repoDocs: RepoDocInfo[]) {

        const state: AppState = Object.assign({}, this.state);

        state.data = repoDocs;

        setTimeout(() => {

            // The react table will not update when I change the state from
            // within the event listener
            this.setState(state);

        }, 1);

    }

    private filterRepoDocInfos(repoDocs: RepoDocInfo[]): RepoDocInfo[] {

        // always filter valid to make sure nothing corrupts the state.  Some
        // other bug might inject a problem otherwise.
        repoDocs = this.doFilterValid(repoDocs);
        repoDocs = this.doFilterByTitle(repoDocs);
        repoDocs = this.doFilterFlaggedOnly(repoDocs);
        repoDocs = this.doFilterHideArchived(repoDocs);
        repoDocs = this.doFilterByTags(repoDocs);

        return repoDocs;

    }

    private doFilterValid(repoDocs: RepoDocInfo[]): RepoDocInfo[] {
        return repoDocs.filter(current => RepoDocInfos.isValid(current));
    }

    private doFilterByTitle(repoDocs: RepoDocInfo[]): RepoDocInfo[] {

        const filterElement = document.querySelector("#filter_title") as HTMLInputElement;

        const filterText = filterElement.value;

        if (! Strings.empty(filterText)) {

            return repoDocs.filter(current => current.title &&
                current.title.toLowerCase().indexOf(filterText!.toLowerCase()) >= 0 );

        }

        return repoDocs;

    }

    private doFilterFlaggedOnly(repoDocs: RepoDocInfo[]): RepoDocInfo[] {

        const filterElement = document.querySelector("#filter_flagged") as HTMLInputElement;

        if (filterElement.checked) {
            return repoDocs.filter(current => current.flagged);
        }

        return repoDocs;

    }

    private doFilterHideArchived(repoDocs: RepoDocInfo[]): RepoDocInfo[] {

        const filterElement = document.querySelector("#filter_archived") as HTMLInputElement;

        if (filterElement.checked) {
            log.info("Applying archived filter");

            return repoDocs.filter(current => !current.archived);
        }

        return repoDocs;

    }

    private doFilterByTags(repoDocs: RepoDocInfo[]): RepoDocInfo[] {

        RendererAnalytics.event({category: 'user', action: 'filter-by-tags'});

        const tags = Tags.toIDs(this.filteredTags.get());

        return repoDocs.filter(current => {

            if (tags.length === 0) {
                // there is no filter in place...
                return true;
            }

            if (! isPresent(current.docInfo.tags)) {
                // the document we're searching over has not tags.
                return false;
            }

            const intersection =
                Sets.intersection(tags, Tags.toIDs(Object.values(current.docInfo.tags!)));

            return intersection.length === tags.length;


        });

    }

    private onDocumentLoadRequested(fingerprint: string,
                                    filename: string,
                                    hashcode?: Hashcode) {

        const handler = async () => {

            const persistenceLayer = this.persistenceLayerManager.get();

            const ref: FileRef = {
                name: filename,
                hashcode
            };

            // NOTE: these operations execute locally first, so it's a quick
            // way to verify that the file needs to be synchronized.
            const requiresSynchronize =
                ! await persistenceLayer.contains(fingerprint) ||
                ! await persistenceLayer.containsFile(Backend.STASH, ref);

            if (requiresSynchronize) {
                await persistenceLayer.synchronizeDocs(fingerprint);
                log.notice("Forcing synchronization (doc not local): " + fingerprint);
            }

            await DocLoader.load({
                fingerprint,
                filename,
                newWindow: true
            });

        };

        handler()
            .catch(err => log.error("Unable to load doc: ", err));

    }

    private async handleToggleField(repoDocInfo: RepoDocInfo, field: string) {

        // TODO: move to syncDocInfoArchived in DocRepository

        let mutated: boolean = false;

        if (field === 'archived') {
            RendererAnalytics.event({category: 'user', action: 'archived-doc'});
            repoDocInfo.archived = !repoDocInfo.archived;
            repoDocInfo.docInfo.archived = repoDocInfo.archived;
            mutated = true;
        }

        if (field === 'flagged') {

            RendererAnalytics.event({category: 'user', action: 'flagged-doc'});
            repoDocInfo.flagged = !repoDocInfo.flagged;
            repoDocInfo.docInfo.flagged = repoDocInfo.flagged;

            mutated = true;
        }

        if (mutated) {
            await this.props.repoDocInfoManager!.writeDocInfo(repoDocInfo.docInfo);
            this.refresh();
        }

    }

    private onUpdatedDocInfo(docInfo: IDocInfo): void {
        log.info("Received DocInfo update (refreshing UI)");
        this.refresh();
    }

}

interface IProps {

    readonly persistenceLayerManager: PersistenceLayerManager;

    readonly updatedDocInfoEventDispatcher: IEventDispatcher<IDocInfo>;

    readonly repoDocInfoManager: RepoDocInfoManager;

    readonly repoDocInfoLoader: RepoDocInfoLoader
}

interface IState {

    // docs: DocDetail[];

    data: RepoDocInfo[];
    columns: TableColumns;
    selected?: number;
}

