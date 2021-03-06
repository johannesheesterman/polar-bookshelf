import * as React from 'react';
import {Logger} from '../../../../web/js/logger/Logger';
import {RepoDocInfoLoader} from '../RepoDocInfoLoader';
import {RepoDocInfoManager} from '../RepoDocInfoManager';
import {FilteredTags} from '../FilteredTags';
import {TableColumns} from '../TableColumns';
import {IDocInfo} from '../../../../web/js/metadata/DocInfo';
import {SyncBar, SyncBarProgress} from '../../../../web/js/ui/sync_bar/SyncBar';
import {IEventDispatcher, SimpleReactor} from '../../../../web/js/reactor/SimpleReactor';
import {DocRepoAnkiSyncController} from '../../../../web/js/controller/DocRepoAnkiSyncController';
import {PrioritizedSplashes} from '../splash/PrioritizedSplashes';
import {PersistenceLayerManager} from '../../../../web/js/datastore/PersistenceLayerManager';
import DocRepoTable from '../doc_repo/DocRepoTable';
import AnnotationRepoTable from './AnnotationRepoTable';

const log = Logger.create();

export default class AnnotationRepoApp extends React.Component<IProps, IState> {

    private readonly persistenceLayerManager: PersistenceLayerManager;

    private readonly docRepository: RepoDocInfoManager;

    private readonly repoDocInfoLoader: RepoDocInfoLoader;

    private readonly filteredTags = new FilteredTags();

    constructor(props: IProps, context: any) {
        super(props, context);

        this.persistenceLayerManager = this.props.persistenceLayerManager;
        this.docRepository = new RepoDocInfoManager(this.persistenceLayerManager);
        this.repoDocInfoLoader = new RepoDocInfoLoader(this.persistenceLayerManager);

        this.state = {
            data: [],
            columns: new TableColumns()
        };

    }

    public render() {

        return (

            <div id="annotation-repository">

                <AnnotationRepoTable persistenceLayerManager={this.props.persistenceLayerManager}
                                     updatedDocInfoEventDispatcher={this.props.updatedDocInfoEventDispatcher}/>

            </div>

        );
    }

}

export interface IProps {

    readonly persistenceLayerManager: PersistenceLayerManager;

    readonly updatedDocInfoEventDispatcher: IEventDispatcher<IDocInfo>;

    readonly syncBarProgress: IEventDispatcher<SyncBarProgress>;
}

export interface IState {

}
